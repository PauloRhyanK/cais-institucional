/**
 * Cloudflare Worker do site institucional — captação "Planejamento".
 *
 * Só atende /planejamento/api/*; o resto segue para os assets estáticos.
 * Guarda o segredo do conector do CRM (Flow.ia), valida e normaliza de novo,
 * calcula os derivados e repassa ao CRM. NÃO guarda lead: a única gravação é no CRM.
 *
 * Contrato: docs/captacao-planejamento/contrato-recebimento.md
 * Perguntas: planejamento/perguntas.js (o mesmo arquivo do navegador).
 * Segredos (wrangler secret put):
 *   FLOWIA_PLANEJAMENTO_URL   = https://<host do CRM>/v1/entrada/<id do conector Planejamento>
 *   FLOWIA_PLANEJAMENTO_TOKEN = segredo do conector (Bearer)
 */
import * as moduloNucleo from "../planejamento/js/nucleo.js";
import * as moduloPerguntas from "../planejamento/perguntas.js";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { atenderGymclub, PREFIXO_GYMCLUB } from "./gymclub.js";
import { atenderEventos, PREFIXOS_EVENTOS } from "./eventos.js";

// nucleo.js e perguntas.js são UMD (scripts clássicos no navegador): conforme o empacotador,
// chegam como CommonJS (default) ou registram um global.
const N = (moduloNucleo && moduloNucleo.default) || globalThis.CaisPlanejamento;
const FORMULARIO = (moduloPerguntas && moduloPerguntas.default) || globalThis.CAIS_PLANEJAMENTO_FORMULARIO;
const lib = { parsePhoneNumberFromString };

const PREFIXO = "/planejamento/api";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODIGO = /^[a-z0-9]{4,16}$/;
const DOMINIO = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
const MAX_CORPO = 16 * 1024;
const MAX_EVENTO = 2 * 1024;
const DURACAO_MINIMA_S = 3; // 7 etapas em menos de 3 s não é preenchimento humano
const EVENTOS = new Set(["visita", "inicio", "etapa", "tentativa_envio", "falha_envio", "concluido"]);
const DISPOSITIVOS = new Set(["mobile", "tablet", "desktop"]);
const ROBOS =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|headless|lighthouse|curl|wget|python-requests|httpclient|okhttp/i;

const ESPERAS_CRM_MS = [500, 2000];
const TIMEOUT_CRM_MS = 10000;
const ORCAMENTO_RETRY_MS = 12000; // não inicia nova tentativa depois disso
const CACHE_LINK_S = 60;

let dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/** Só para testes: troca a espera entre tentativas. */
export function _definirEspera(fn) {
  dormir = fn;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const deEventos = PREFIXOS_EVENTOS.some((p) => url.pathname.startsWith(p));
    if (deEventos || url.pathname.startsWith(PREFIXO_GYMCLUB + "/")) {
      try {
        return await (deEventos ? atenderEventos : atenderGymclub)(request, url, env);
      } catch (_) {
        return json(503, { erro: { codigo: "INDISPONIVEL" } });
      }
    }
    if (url.pathname !== PREFIXO && !url.pathname.startsWith(PREFIXO + "/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    const inicio = Date.now();
    const registro = { rota: rotaParaLog(url.pathname), metodo: request.method };
    let resposta;
    try {
      resposta = await rotear(request, url, env, ctx, registro);
    } catch (_) {
      resposta = json(503, { erro: { codigo: "INDISPONIVEL" } });
    }
    // Logs só com metadados: nunca corpo, nunca IP.
    console.log(JSON.stringify({ ...registro, status: resposta.status, ms: Date.now() - inicio }));
    return resposta;
  },
};

function rotaParaLog(caminho) {
  return caminho.replace(/\/link\/[^/]+$/, "/link/:codigo");
}

async function rotear(request, url, env, ctx, registro) {
  const resto = url.pathname.slice(PREFIXO.length);
  if (resto === "/envios") {
    return request.method === "POST" ? receberEnvio(request, url, env, registro) : metodoNaoPermitido("POST");
  }
  if (resto === "/eventos") {
    return request.method === "POST" ? receberEvento(request, env, ctx) : metodoNaoPermitido("POST");
  }
  const link = /^\/link\/([^/]+)$/.exec(resto);
  if (link) {
    return request.method === "GET" ? consultarLink(link[1], env, ctx) : metodoNaoPermitido("GET");
  }
  return json(404, { erro: { codigo: "NAO_ENCONTRADO" } });
}

// ======================================================================
// POST /planejamento/api/envios
// ======================================================================
async function receberEnvio(request, url, env, registro) {
  const origem = request.headers.get("Origin");
  if (origem && origem !== url.origin) return json(403, { erro: { codigo: "ORIGEM_NAO_PERMITIDA" } });
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) {
    return json(415, { erro: { codigo: "FORMATO_NAO_ACEITO" } });
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_CORPO) return json(413, { erro: { codigo: "ENVIO_GRANDE_DEMAIS" } });

  if (env.LIMITE_ENVIOS) {
    const chave = await resumoIp(request.headers.get("CF-Connecting-IP") || "");
    const { success } = await env.LIMITE_ENVIOS.limit({ key: chave });
    if (!success) return json(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": "60" });
  }

  let corpo;
  try {
    corpo = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return invalido(["corpo"]);
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return invalido(["corpo"]);

  // Honeypot e preenchimento instantâneo: responde como sucesso e descarta.
  const duracao = corpo.envio && corpo.envio.duracao_segundos;
  if ((typeof corpo.site === "string" && corpo.site.trim() !== "") || (Number.isInteger(duracao) && duracao < DURACAO_MINIMA_S)) {
    registro.descartado = true;
    return json(200, { recebido: true });
  }

  const { erros, lead } = montarLead(corpo, env);
  if (erros.length) return invalido(erros);

  if (!env.FLOWIA_PLANEJAMENTO_URL || !env.FLOWIA_PLANEJAMENTO_TOKEN) {
    registro.configuracao = "ausente";
    return json(503, { erro: { codigo: "INDISPONIVEL" } });
  }
  return entregarAoCrm(jsonCanonico(lead), env, registro);
}

function invalido(campos) {
  // Só os caminhos dos campos; nunca os valores.
  return json(400, { erro: { codigo: "ENVIO_INVALIDO", campos } });
}

/**
 * Valida o corpo do navegador e monta o LeadDoSite do CRM.
 * As respostas seguem como lista legível (pergunta/resposta), como nas outras campanhas;
 * só perguntas com `campo_crm` viram também campo fixo. Campos vazios são omitidos.
 */
export function montarLead(corpo, _env, formulario = FORMULARIO) {
  const erros = [];

  const id = typeof corpo.id === "string" ? corpo.id.toLowerCase() : "";
  if (!UUID_V4.test(id)) erros.push("id");

  let link = null;
  if (corpo.link !== undefined && corpo.link !== null && corpo.link !== "") {
    link = typeof corpo.link === "string" ? corpo.link.toLowerCase() : "";
    if (!CODIGO.test(link)) erros.push("link");
  }

  const p = objeto(corpo.pessoa);
  const nome = N.validarNome(p.nome);
  if (!nome.ok) erros.push("pessoa.nome");
  const telefone = typeof p.telefone === "string" ? N.normalizarTelefone(p.telefone, lib, { apenasBrasil: true }) : { ok: false };
  if (!telefone.ok) erros.push("pessoa.telefone");
  const emailValidado = typeof p.email === "string" ? N.validarEmail(p.email, true) : { ok: false };
  if (!emailValidado.ok) erros.push("pessoa.email");
  const email = emailValidado.ok ? emailValidado.valor : null;

  // Respostas: validadas pergunta a pergunta, na ordem (para `minimoDe`). Chaves desconhecidas são ignoradas.
  const brutas = objeto(corpo.respostas);
  const respostas = {};
  for (const pergunta of formulario.perguntas) {
    const r = N.validarResposta(pergunta, brutas[pergunta.chave], respostas);
    if (!r.ok) erros.push(`respostas.${pergunta.chave}`);
    else if (r.valor != null) respostas[pergunta.chave] = r.valor;
  }

  const utm = {};
  if (corpo.utm !== undefined) {
    const u = objeto(corpo.utm);
    for (const chave of N.UTM_CHAVES) {
      if (u[chave] === undefined || u[chave] === null) continue;
      if (typeof u[chave] !== "string") {
        erros.push(`utm.${chave}`);
        continue;
      }
      const v = N.normalizarEspacos(u[chave]).slice(0, 500);
      if (v) utm[chave] = v;
    }
  }

  const e = objeto(corpo.envio);
  if (!textoCurto(e.form_versao, 50)) erros.push("envio.form_versao");
  if (e.privacidade_versao !== undefined && !textoCurto(e.privacidade_versao, 50)) erros.push("envio.privacidade_versao");
  if (e.duracao_segundos !== undefined && !(Number.isInteger(e.duracao_segundos) && e.duracao_segundos >= 0 && e.duracao_segundos <= 86400)) {
    erros.push("envio.duracao_segundos");
  }
  if (e.dispositivo !== undefined && !DISPOSITIVOS.has(e.dispositivo)) erros.push("envio.dispositivo");
  const sessao = typeof e.sessao_id === "string" ? e.sessao_id.toLowerCase() : "";
  if (!UUID_V4.test(sessao)) erros.push("envio.sessao_id");
  if (e.referencia_dominio !== undefined && !(typeof e.referencia_dominio === "string" && DOMINIO.test(e.referencia_dominio))) {
    erros.push("envio.referencia_dominio");
  }

  if (erros.length) return { erros, lead: null };

  const campos = { form_versao: e.form_versao, sessao_id: sessao, ...utm };
  for (const pergunta of formulario.perguntas) {
    if (pergunta.campo_crm && respostas[pergunta.chave] != null) campos[pergunta.campo_crm] = respostas[pergunta.chave];
  }
  if (link) campos.link_de_captacao = link;
  if (e.privacidade_versao) campos.privacidade_versao = e.privacidade_versao;
  if (e.duracao_segundos !== undefined) campos.duracao_segundos = e.duracao_segundos;
  if (e.dispositivo) campos.dispositivo = e.dispositivo;
  if (e.referencia_dominio) campos.site_de_origem = e.referencia_dominio.toLowerCase();

  const pessoa = { nome: nome.valor, telefone: telefone.e164 };
  if (email) pessoa.email = email;

  const legiveis = N.respostasLegiveis(formulario, respostas, "crm").map(({ pergunta, resposta }) => ({ pergunta, resposta }));
  return { erros, lead: { id: `planejamento:${id}`, pessoa, campos, respostas: legiveis } };
}

/** Repassa ao CRM com até 2 tentativas rápidas (0,5 s e 2 s) para 5xx, timeout e rede. */
async function entregarAoCrm(corpoJson, env, registro) {
  const inicio = Date.now();
  for (let tentativa = 0; ; tentativa++) {
    let r = null;
    try {
      r = await comTimeout(
        `${base(env)}/lead`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.FLOWIA_PLANEJAMENTO_TOKEN}`, "Content-Type": "application/json" },
          body: corpoJson,
        },
        TIMEOUT_CRM_MS
      );
    } catch (_) {
      r = null;
    }
    registro.crm = r ? r.status : "rede";
    registro.tentativas = tentativa + 1;

    if (r) {
      if (r.status === 200) {
        const corpo = await lerJson(r);
        if (corpo && corpo.recebido === true) return json(200, { recebido: true });
        if (corpo && corpo.recebido === false) return json(409, { erro: { codigo: "ENVIO_DIFERENTE" } });
        return json(503, { erro: { codigo: "INDISPONIVEL" } });
      }
      if (r.status === 400) return json(400, { erro: { codigo: "ENVIO_MAL_FORMADO" } });
      if (r.status === 429) {
        return json(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": r.headers.get("Retry-After") || "60" });
      }
      if (r.status < 500) return json(503, { erro: { codigo: "INDISPONIVEL" } }); // 401/403/404: configuração
    }

    const espera = ESPERAS_CRM_MS[tentativa];
    if (espera === undefined || Date.now() - inicio > ORCAMENTO_RETRY_MS) {
      return json(503, { erro: { codigo: "INDISPONIVEL" } });
    }
    await dormir(espera);
  }
}

// ======================================================================
// GET /planejamento/api/link/{codigo}
// ======================================================================
async function consultarLink(bruto, env, ctx) {
  let codigo;
  try {
    codigo = decodeURIComponent(bruto).toLowerCase();
  } catch (_) {
    codigo = "";
  }
  if (!CODIGO.test(codigo)) return json(400, { erro: { codigo: "CODIGO_INVALIDO" } });
  if (!env.FLOWIA_PLANEJAMENTO_URL || !env.FLOWIA_PLANEJAMENTO_TOKEN) {
    return json(503, { erro: { codigo: "INDISPONIVEL" } });
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const chaveCache = new Request(`https://cache.planejamento.interno/link/${codigo}`);
  if (cache) {
    const salvo = await cache.match(chaveCache);
    if (salvo) return salvo;
  }

  try {
    const r = await comTimeout(
      `${base(env)}/ligacao/link_de_captacao/${encodeURIComponent(codigo)}`,
      { headers: { Authorization: `Bearer ${env.FLOWIA_PLANEJAMENTO_TOKEN}` } },
      5000
    );
    const corpo = r.status === 200 ? await lerJson(r) : null;
    if (corpo && typeof corpo.ativo === "boolean") {
      // Só o booleano sai do Worker, nada do cadastro.
      const resposta = json(200, { ativo: corpo.ativo }, { "Cache-Control": `public, max-age=${CACHE_LINK_S}` });
      if (cache) ctx.waitUntil(cache.put(chaveCache, resposta.clone()));
      return resposta;
    }
  } catch (_) {}
  // CRM fora do ar: o navegador segue com o formulário e manda o código mesmo assim.
  return json(503, { erro: { codigo: "INDISPONIVEL" } });
}

// ======================================================================
// POST /planejamento/api/eventos — sempre 204; métrica, não lead
// ======================================================================
async function receberEvento(request, env, ctx) {
  const vazio = new Response(null, { status: 204 });
  if (ROBOS.test(request.headers.get("User-Agent") || "")) return vazio;
  if (!env.FLOWIA_PLANEJAMENTO_URL || !env.FLOWIA_PLANEJAMENTO_TOKEN) return vazio;

  let corpo;
  try {
    const texto = await request.text();
    if (texto.length > MAX_EVENTO) return vazio;
    corpo = JSON.parse(texto);
  } catch (_) {
    return vazio;
  }
  const evento = montarEvento(corpo);
  if (!evento) return vazio;

  ctx.waitUntil(
    comTimeout(
      `${base(env)}/evento`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.FLOWIA_PLANEJAMENTO_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(evento),
      },
      TIMEOUT_CRM_MS
    ).catch(() => {})
  );
  return vazio;
}

/** Só os campos do contrato seguem; id determinístico para contar uma vez por sessão. */
export function montarEvento(c) {
  if (!c || typeof c !== "object") return null;
  const sessao = typeof c.sessao_id === "string" ? c.sessao_id.toLowerCase() : "";
  if (!UUID_V4.test(sessao) || !EVENTOS.has(c.evento) || !textoCurto(c.form_versao, 50)) return null;
  const temEtapa = c.evento === "etapa";
  const totalEtapas = FORMULARIO.perguntas.length + 1;
  if (temEtapa && !(Number.isInteger(c.etapa) && c.etapa >= 1 && c.etapa <= totalEtapas)) return null;
  let link = null;
  if (c.link !== undefined && c.link !== null && c.link !== "") {
    link = typeof c.link === "string" ? c.link.toLowerCase() : "";
    if (!CODIGO.test(link)) return null;
  }
  const evento = {
    id: `evento:${sessao}:${c.evento}${temEtapa ? `:${c.etapa}` : ""}`,
    sessao_id: sessao,
    evento: c.evento,
    form_versao: c.form_versao,
  };
  if (link) evento.link = link;
  if (temEtapa) evento.etapa = c.etapa;
  return evento;
}

// ======================================================================
// Utilitários
// ======================================================================
/** JSON com chaves em ordem alfabética em todos os níveis (impressão estável para o CRM). */
export function jsonCanonico(valor) {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      const saida = {};
      for (const k of Object.keys(v).sort()) saida[k] = ordenar(v[k]);
      return saida;
    }
    return v;
  };
  return JSON.stringify(ordenar(valor));
}

function base(env) {
  return env.FLOWIA_PLANEJAMENTO_URL.replace(/\/+$/, "");
}

async function comTimeout(url, opcoes, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opcoes, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function lerJson(r) {
  try {
    return await r.json();
  } catch (_) {
    return null;
  }
}

async function resumoIp(ip) {
  // Chave do rate limit: hash do IP (o IP em si não é guardado nem registrado).
  const dados = new TextEncoder().encode(`planejamento:${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function objeto(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function textoCurto(v, max) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function metodoNaoPermitido(permitido) {
  return json(405, { erro: { codigo: "METODO_NAO_PERMITIDO" } }, { Allow: permitido });
}

function json(status, corpo, cabecalhos) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cabecalhos || {}) },
  });
}
