/**
 * Captação na Gym Club — cadastro feito pelos colaboradores no evento.
 * POST /gymclub/api/cadastros grava no D1 (binding DB, tabela cadastros_eventos).
 * A tabela é criada sozinha no primeiro cadastro (ESQUEMA abaixo).
 *
 * Consulta e exclusão (aba "Gym Club" do painel /eventos/admin/):
 *   GET    /gymclub/api/admin/cadastros
 *   DELETE /gymclub/api/admin/cadastros/{id}
 * Exigem a sessão do painel (Authorization: Bearer <token>), conferida no mesmo
 * Supabase que faz o login do painel.
 */
import * as moduloNucleo from "../planejamento/js/nucleo.js";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

const N = (moduloNucleo && moduloNucleo.default) || globalThis.CaisPlanejamento;
const lib = { parsePhoneNumberFromString };

export const PREFIXO_GYMCLUB = "/gymclub/api";
const EVENTO = "gymclub";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CORPO = 8 * 1024;
const MAX_OBSERVACOES = 1000;

// `id` vem do aparelho (UUID): reenviar o mesmo cadastro não duplica.
const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS cadastros_eventos (
     id          TEXT PRIMARY KEY,
     evento      TEXT NOT NULL,
     colaborador TEXT NOT NULL,
     nome        TEXT NOT NULL,
     telefone    TEXT,
     email       TEXT,
     observacoes TEXT,
     criado_em   TEXT,
     recebido_em TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cadastros_eventos_evento ON cadastros_eventos (evento, recebido_em)`,
];

// Mesmo projeto e chave pública que o painel do Evento Offshore já usa no navegador.
const SUPABASE_URL = "https://laukfwrsdvchozgicjxm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdWtmd3JzZHZjaG96Z2ljanhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTc0MDEsImV4cCI6MjEwOTM5MzQwMX0.YL1UZkZlPFjWlpJkMUZjW-y7xU4c-D1KXYtQIiFkzMo";

export async function atenderGymclub(request, url, env) {
  if (url.pathname.startsWith(PREFIXO_GYMCLUB + "/admin/")) return atenderAdmin(request, url, env);
  if (url.pathname !== PREFIXO_GYMCLUB + "/cadastros") return json(404, { erro: { codigo: "NAO_ENCONTRADO" } });
  if (request.method !== "POST") return json(405, { erro: { codigo: "METODO_NAO_PERMITIDO" } }, { Allow: "POST" });

  const origem = request.headers.get("Origin");
  if (origem && origem !== url.origin) return json(403, { erro: { codigo: "ORIGEM_NAO_PERMITIDA" } });
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) {
    return json(415, { erro: { codigo: "FORMATO_NAO_ACEITO" } });
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_CORPO) return json(413, { erro: { codigo: "ENVIO_GRANDE_DEMAIS" } });

  if (env.LIMITE_CADASTROS) {
    const { success } = await env.LIMITE_CADASTROS.limit({ key: request.headers.get("CF-Connecting-IP") || "" });
    if (!success) return json(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": "60" });
  }

  let corpo;
  try {
    corpo = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    corpo = null;
  }
  const { erros, cadastro: c } = montarCadastro(corpo);
  if (erros.length) return json(400, { erro: { codigo: "ENVIO_INVALIDO", campos: erros } });

  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });
  const gravar = () =>
    env.DB.prepare(
      `INSERT INTO cadastros_eventos (id, evento, colaborador, nome, telefone, email, observacoes, criado_em, recebido_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`
    )
      .bind(c.id, EVENTO, c.colaborador, c.nome, c.telefone, c.email, c.observacoes, c.criado_em, new Date().toISOString())
      .run();
  try {
    await gravar();
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
    await env.DB.batch(ESQUEMA.map((sql) => env.DB.prepare(sql)));
    await gravar();
  }
  return json(200, { recebido: true });
}

async function atenderAdmin(request, url, env) {
  const resto = url.pathname.slice((PREFIXO_GYMCLUB + "/admin").length);
  const excluir = /^\/cadastros\/([^/]+)$/.exec(resto);
  if (resto !== "/cadastros" && !excluir) return json(404, { erro: { codigo: "NAO_ENCONTRADO" } });
  const esperado = excluir ? "DELETE" : "GET";
  if (request.method !== esperado) return json(405, { erro: { codigo: "METODO_NAO_PERMITIDO" } }, { Allow: esperado });

  const origem = request.headers.get("Origin");
  if (origem && origem !== url.origin) return json(403, { erro: { codigo: "ORIGEM_NAO_PERMITIDA" } });
  if (!(await sessaoDoPainelValida(request))) return json(401, { erro: { codigo: "NAO_AUTORIZADO" } });
  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });

  try {
    if (excluir) {
      const id = excluir[1].toLowerCase();
      if (!UUID_V4.test(id)) return json(400, { erro: { codigo: "ID_INVALIDO" } });
      await env.DB.prepare("DELETE FROM cadastros_eventos WHERE id = ? AND evento = ?").bind(id, EVENTO).run();
      return json(200, { excluido: true });
    }
    const { results } = await env.DB.prepare(
      `SELECT id, colaborador, nome, telefone, email, observacoes, criado_em, recebido_em
       FROM cadastros_eventos WHERE evento = ? ORDER BY recebido_em DESC`
    )
      .bind(EVENTO)
      .all();
    return json(200, { cadastros: results });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json(200, excluir ? { excluido: true } : { cadastros: [] });
    throw e;
  }
}

/** A sessão vale se o Supabase do painel aceitar o token (a mesma chamada que o painel faz ao abrir). */
async function sessaoDoPainelValida(request) {
  const m = /^Bearer\s+(\S{8,512})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_list_confirmacoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_token: m[1] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const corpo = await r.json();
    return !!corpo && corpo.ok === true;
  } catch (_) {
    return false;
  }
}

export function montarCadastro(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erros: ["corpo"], cadastro: null };
  const erros = [];

  const id = typeof corpo.id === "string" ? corpo.id.toLowerCase() : "";
  if (!UUID_V4.test(id)) erros.push("id");

  const colaborador = N.validarNome(corpo.colaborador);
  if (!colaborador.ok) erros.push("colaborador");
  const nome = N.validarNome(corpo.nome);
  if (!nome.ok) erros.push("nome");

  // Contato: telefone, e-mail ou os dois — pelo menos um.
  let telefone = null;
  if (vazio(corpo.telefone)) telefone = null;
  else {
    const t = typeof corpo.telefone === "string" ? N.normalizarTelefone(corpo.telefone, lib, { apenasBrasil: true }) : { ok: false };
    if (t.ok) telefone = t.e164;
    else erros.push("telefone");
  }
  let email = null;
  if (!vazio(corpo.email)) {
    const e = typeof corpo.email === "string" ? N.validarEmail(corpo.email, true) : { ok: false };
    if (e.ok) email = e.valor.toLowerCase();
    else erros.push("email");
  }
  if (vazio(corpo.telefone) && vazio(corpo.email)) erros.push("contato");

  let observacoes = null;
  if (!vazio(corpo.observacoes)) {
    if (typeof corpo.observacoes !== "string" || corpo.observacoes.length > MAX_OBSERVACOES) erros.push("observacoes");
    else observacoes = corpo.observacoes.trim() || null;
  }

  // Hora do aparelho é só informativa: se vier estranha, fica vazia.
  const quando = typeof corpo.criado_em === "string" ? new Date(corpo.criado_em) : null;
  const criado_em = quando && !Number.isNaN(quando.getTime()) ? quando.toISOString() : null;

  if (erros.length) return { erros, cadastro: null };
  return { erros, cadastro: { id, colaborador: colaborador.valor, nome: nome.valor, telefone, email, observacoes, criado_em } };
}

function vazio(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function json(status, corpo, cabecalhos) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cabecalhos || {}) },
  });
}
