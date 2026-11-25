import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker, { _definirEspera, jsonCanonico } from "../index.js";

const CRM = "https://crm.teste/v1/entrada/conector-planejamento";
const ENV = {
  FLOWIA_PLANEJAMENTO_URL: CRM,
  FLOWIA_PLANEJAMENTO_TOKEN: "segredo-de-teste",
};
const SITE = "https://caisinvestimentos.com.br";
const ID = "6f1c0b9e-2d7a-4c1e-9d0b-5a3e8f2c7b11";
const SESSAO = "3b2f9a4e-8c1d-4f6a-b7e2-1d9c0a5f3e88";

function corpoNavegador(extra = {}) {
  return {
    id: ID,
    link: "a7k2m9",
    pessoa: { nome: "  Ana   Souza ", telefone: "+5527999998888", email: "ana+inv@exemplo.com" },
    respostas: {
      canal: "indicacao_assessor",
      patrimonio: "acima_500k_ate_1m",
      experiencia: "acima_3m_ate_12m",
      aporte: "acima_10_ate_20",
      idade_atual: 30,
      idade_objetivo: 50,
      renda: 1500000,
      chave_que_nao_existe: "ignorada",
    },
    utm: { utm_source: "instagram", utm_medium: "stories" },
    envio: {
      form_versao: "planejamento-v3",
      privacidade_versao: "2026-11-30",
      duracao_segundos: 94,
      dispositivo: "mobile",
      sessao_id: SESSAO,
      referencia_dominio: "instagram.com",
    },
    site: "",
    ...extra,
  };
}

/** Fila de respostas do CRM simulado; registra cada chamada. */
let chamadas;
let filaCrm;
function respostaCrm(status, corpo, cabecalhos) {
  return new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", ...(cabecalhos || {}) },
  });
}

beforeEach(() => {
  chamadas = [];
  filaCrm = [];
  _definirEspera(async () => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), metodo: opcoes.method || "GET", cabecalhos: opcoes.headers || {}, corpo: opcoes.body });
    const proxima = filaCrm.shift();
    if (proxima instanceof Error) throw proxima;
    return proxima || respostaCrm(200, { recebido: true, numero: "planejamento:x" });
  });
});
afterEach(() => vi.restoreAllMocks());

async function chamar(caminho, { metodo = "GET", corpo, cabecalhos = {}, env = ENV } = {}) {
  const init = { method: metodo, headers: { Origin: SITE, ...cabecalhos } };
  if (corpo !== undefined) {
    init.body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    if (!("Content-Type" in cabecalhos)) init.headers["Content-Type"] = "application/json";
  }
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(SITE + caminho, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}
const enviar = (corpo, opcoes) => chamar("/planejamento/api/envios", { metodo: "POST", corpo, ...opcoes });

describe("POST /planejamento/api/envios", () => {
  it("monta o LeadDoSite: respostas legíveis, só patrimônio fixo, chaves em ordem alfabética e Bearer", async () => {
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ recebido: true });
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0];
    expect(c.url).toBe(`${CRM}/lead`);
    expect(c.metodo).toBe("POST");
    expect(c.cabecalhos.Authorization).toBe("Bearer segredo-de-teste");
    expect(c.corpo).toBe(jsonCanonico(JSON.parse(c.corpo)));
    const lead = JSON.parse(c.corpo);
    expect(lead).toEqual({
      id: `planejamento:${ID}`,
      pessoa: { nome: "Ana Souza", telefone: "+5527999998888", email: "ana+inv@exemplo.com" },
      campos: {
        dispositivo: "mobile",
        duracao_segundos: 94,
        form_versao: "planejamento-v3",
        link_de_captacao: "a7k2m9",
        patrimonio_faixa: "acima_500k_ate_1m",
        privacidade_versao: "2026-11-30",
        sessao_id: SESSAO,
        site_de_origem: "instagram.com",
        utm_medium: "stories",
        utm_source: "instagram",
      },
      respostas: [
        { pergunta: "Através de qual canal você conheceu a Cais Investimentos?", resposta: "Indicação de um assessor" },
        { pergunta: "Qual é o seu patrimônio atual?", resposta: "Acima de R$ 500 mil até R$ 1 milhão" },
        { pergunta: "Há quanto tempo você investe regularmente?", resposta: "Acima de 3 meses até 12 meses" },
        { pergunta: "Quanto da sua renda você consegue investir todos os meses?", resposta: "Acima de 10% até 20%" },
        { pergunta: "Quantos anos você tem?", resposta: "30 anos" },
        { pergunta: "Com qual idade você pretende viver de renda?", resposta: "50 anos" },
        { pergunta: "Horizonte de planejamento", resposta: "20 anos" },
        { pergunta: "Quanto você gostaria de receber por mês ao viver de renda?", resposta: "R$ 15.000,00" },
        { pergunta: "Renda anual desejada", resposta: "R$ 180.000,00" },
      ],
    });
    expect(c.corpo).not.toMatch(/"enviado_em"|"origem"|parceiro|campanha|null|chave_que_nao_existe/);
  });

  it("mesmo envio duas vezes: bytes idênticos ao CRM e sucesso nas duas", async () => {
    filaCrm = [respostaCrm(200, { recebido: true }), respostaCrm(200, { recebido: true })];
    const a = await enviar(corpoNavegador());
    const b = await enviar(corpoNavegador());
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(chamadas[0].corpo).toBe(chamadas[1].corpo);
  });

  it("503 e depois 200: retry interno com o mesmo corpo", async () => {
    filaCrm = [respostaCrm(503, {}), respostaCrm(200, { recebido: true })];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(200);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].corpo).toBe(chamadas[1].corpo);
  });

  it("5xx, rede e timeout esgotam as 2 tentativas rápidas: 503 ao navegador", async () => {
    filaCrm = [respostaCrm(500, {}), new TypeError("rede"), respostaCrm(502, {})];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(503);
    expect(chamadas).toHaveLength(3);
  });

  it("200 recebido:false: 409 ENVIO_DIFERENTE", async () => {
    filaCrm = [respostaCrm(200, { recebido: false, numero: "planejamento:x" })];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erro: { codigo: "ENVIO_DIFERENTE" } });
  });

  it("400 do CRM: 400 sem retry", async () => {
    filaCrm = [respostaCrm(400, { erro: { codigo: "ENVIO_MAL_FORMADO" } })];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(400);
    expect(chamadas).toHaveLength(1);
  });

  it.each([403, 404, 401])("%i do CRM (configuração): 503 ao navegador, sem retry", async (status) => {
    filaCrm = [respostaCrm(status, { erro: { codigo: "SEM_PERMISSAO" } })];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(503);
    expect(chamadas).toHaveLength(1);
  });

  it("429 do CRM: repassa 429 com Retry-After", async () => {
    filaCrm = [respostaCrm(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": "7" })];
    const r = await enviar(corpoNavegador());
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("7");
  });

  it("e-mail ausente ou vazio: 400 pessoa.email (e-mail obrigatório)", async () => {
    for (const email of [undefined, "", "   "]) {
      const corpo = corpoNavegador();
      if (email === undefined) delete corpo.pessoa.email;
      else corpo.pessoa.email = email;
      const r = await enviar(corpo);
      expect(r.status).toBe(400);
      expect((await r.json()).erro.campos).toEqual(["pessoa.email"]);
    }
    expect(chamadas).toHaveLength(0);
  });

  it("acesso direto e 'Ainda não sei': chaves omitidas, resposta legível", async () => {
    const corpo = corpoNavegador();
    delete corpo.link;
    delete corpo.utm;
    delete corpo.envio.referencia_dominio;
    corpo.respostas.renda = "nao_sei";
    const r = await enviar(corpo);
    expect(r.status).toBe(200);
    const lead = JSON.parse(chamadas[0].corpo);
    expect(lead.pessoa).toEqual({ nome: "Ana Souza", telefone: "+5527999998888", email: "ana+inv@exemplo.com" });
    expect(lead.respostas.at(-1)).toEqual({ pergunta: "Quanto você gostaria de receber por mês ao viver de renda?", resposta: "Ainda não sei" });
    expect(lead.respostas.map((x) => x.pergunta)).not.toContain("Renda anual desejada");
    for (const k of ["link_de_captacao", "utm_source", "site_de_origem"]) expect(lead.campos).not.toHaveProperty(k);
  });

  it("normaliza telefone com e sem +55 e DDD 55", async () => {
    for (const [entrada, esperado] of [
      ["(27) 99999-8888", "+5527999998888"],
      ["5527999998888", "+5527999998888"],
      ["55999998888", "+5555999998888"],
    ]) {
      chamadas = [];
      const corpo = corpoNavegador();
      corpo.pessoa.telefone = entrada;
      await enviar(corpo);
      expect(JSON.parse(chamadas[0].corpo).pessoa.telefone).toBe(esperado);
    }
  });

  it.each([
    ["idade pretendida menor que a atual", (c) => (c.respostas.idade_objetivo = 29), ["respostas.idade_objetivo"]],
    ["idade abaixo da mínima", (c) => (c.respostas.idade_atual = 17), ["respostas.idade_atual"]],
    ["renda zero", (c) => (c.respostas.renda = 0), ["respostas.renda"]],
    ["renda como texto inválido", (c) => (c.respostas.renda = "muito"), ["respostas.renda"]],
    ["pergunta obrigatória sem resposta", (c) => delete c.respostas.aporte, ["respostas.aporte"]],
    ["opção desconhecida", (c) => (c.respostas.patrimonio = "muito"), ["respostas.patrimonio"]],
    ["telefone internacional", (c) => (c.pessoa.telefone = "+12025550123"), ["pessoa.telefone"]],
    ["nome só com espaços", (c) => (c.pessoa.nome = "   "), ["pessoa.nome"]],
    ["e-mail inválido", (c) => (c.pessoa.email = "ana@exemplo"), ["pessoa.email"]],
    ["id que não é uuid v4", (c) => (c.id = "123"), ["id"]],
    ["código de link fora do formato", (c) => (c.link = "abc"), ["link"]],
  ])("400 sem chamar o CRM: %s", async (_, alterar, campos) => {
    const corpo = corpoNavegador();
    alterar(corpo);
    const r = await enviar(corpo);
    expect(r.status).toBe(400);
    const resposta = await r.json();
    expect(resposta).toEqual({ erro: { codigo: "ENVIO_INVALIDO", campos } });
    expect(JSON.stringify(resposta)).not.toMatch(/Ana|9999|2025550123/);
    expect(chamadas).toHaveLength(0);
  });

  it("aceita 100 anos e horizonte zero", async () => {
    const horizonte = () => JSON.parse(chamadas[0].corpo).respostas.find((x) => x.pergunta === "Horizonte de planejamento").resposta;
    const corpo = corpoNavegador();
    corpo.respostas.idade_objetivo = 100;
    await enviar(corpo);
    expect(horizonte()).toBe("70 anos");
    chamadas = [];
    corpo.respostas.idade_objetivo = 30;
    await enviar(corpo);
    expect(horizonte()).toBe("0 anos");
  });

  it("honeypot e preenchimento instantâneo: 200 recebido, nada vai ao CRM", async () => {
    expect((await enviar(corpoNavegador({ site: "http://spam" }))).status).toBe(200);
    const rapido = corpoNavegador();
    rapido.envio.duracao_segundos = 1;
    expect((await enviar(rapido)).status).toBe(200);
    expect(chamadas).toHaveLength(0);
  });

  it("protocolo: 415, 413, 403 de outra origem, 405 e JSON quebrado", async () => {
    expect((await enviar(corpoNavegador(), { cabecalhos: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await enviar(JSON.stringify(corpoNavegador({ site: "x".repeat(17000) })))).status).toBe(413);
    expect((await enviar(corpoNavegador(), { cabecalhos: { Origin: "https://malicioso.example" } })).status).toBe(403);
    expect((await chamar("/planejamento/api/envios")).status).toBe(405);
    expect((await enviar("{quebrado")).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("sem segredo configurado: 503", async () => {
    const r = await enviar(corpoNavegador(), { env: {} });
    expect(r.status).toBe(503);
    expect(chamadas).toHaveLength(0);
  });

  it("log só com metadados (sem corpo, nome ou telefone)", async () => {
    const log = vi.spyOn(console, "log");
    await enviar(corpoNavegador());
    const texto = log.mock.calls.flat().join(" ");
    expect(texto).toMatch(/"status":200/);
    expect(texto).not.toMatch(/Ana|99999|1500000|15\.000|instagram/);
  });
});

describe("GET /planejamento/api/link/{codigo}", () => {
  it("ativo:false do CRM vira ativo:false, só o booleano", async () => {
    filaCrm = [respostaCrm(200, { ativo: false, parceiro: "não deve sair" })];
    const r = await chamar("/planejamento/api/link/ZZZZ99");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ativo: false });
    expect(chamadas[0].url).toBe(`${CRM}/ligacao/link_de_captacao/zzzz99`);
    expect(chamadas[0].cabecalhos.Authorization).toBe("Bearer segredo-de-teste");
  });

  it("CRM fora do ar ou rota inexistente: 503 (o site segue com o formulário)", async () => {
    filaCrm = [respostaCrm(404, {})];
    expect((await chamar("/planejamento/api/link/q1w2e3")).status).toBe(503);
    filaCrm = [new TypeError("rede")];
    expect((await chamar("/planejamento/api/link/q1w2e4")).status).toBe(503);
  });

  it("formato inválido: 400 sem consultar o CRM", async () => {
    expect((await chamar("/planejamento/api/link/a%3Cb%3E")).status).toBe(400);
    expect((await chamar("/planejamento/api/link/abcdefghijklmnopq")).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });
});

describe("POST /planejamento/api/eventos", () => {
  const evento = (e) => chamar("/planejamento/api/eventos", { metodo: "POST", corpo: e, cabecalhos: { "Content-Type": "text/plain;charset=UTF-8" } });

  it("repassa só os campos do contrato com id determinístico", async () => {
    const r = await evento({ sessao_id: SESSAO, link: "a7k2m9", evento: "etapa", etapa: 3, form_versao: "planejamento-v1", nome: "Ana" });
    expect(r.status).toBe(204);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${CRM}/evento`);
    expect(JSON.parse(chamadas[0].corpo)).toEqual({
      id: `evento:${SESSAO}:etapa:3`,
      sessao_id: SESSAO,
      link: "a7k2m9",
      evento: "etapa",
      etapa: 3,
      form_versao: "planejamento-v1",
    });
  });

  it("acesso direto: sem link; id sem etapa", async () => {
    await evento({ sessao_id: SESSAO, evento: "concluido", form_versao: "planejamento-v1" });
    expect(JSON.parse(chamadas[0].corpo)).toEqual({
      id: `evento:${SESSAO}:concluido`,
      sessao_id: SESSAO,
      evento: "concluido",
      form_versao: "planejamento-v1",
    });
  });

  it("inválido, robô ou CRM fora do ar: sempre 204", async () => {
    expect((await evento({ sessao_id: SESSAO, evento: "pagamento", form_versao: "v1" })).status).toBe(204);
    expect((await evento({ sessao_id: SESSAO, evento: "etapa", etapa: 9, form_versao: "v1" })).status).toBe(204);
    expect((await evento("{quebrado")).status).toBe(204);
    expect(chamadas).toHaveLength(0);
    const robo = await chamar("/planejamento/api/eventos", {
      metodo: "POST",
      corpo: { sessao_id: SESSAO, evento: "visita", form_versao: "v1" },
      cabecalhos: { "Content-Type": "text/plain", "User-Agent": "facebookexternalhit/1.1" },
    });
    expect(robo.status).toBe(204);
    expect(chamadas).toHaveLength(0);
    filaCrm = [new TypeError("rede")];
    expect((await evento({ sessao_id: SESSAO, evento: "visita", form_versao: "v1" })).status).toBe(204);
  });
});

describe("demais rotas", () => {
  it("fora de /planejamento/api segue para os assets", async () => {
    const ASSETS = { fetch: vi.fn(async () => new Response("pagina")) };
    const r = await chamar("/planejamento/r/a7k2m9", { env: { ...ENV, ASSETS } });
    expect(await r.text()).toBe("pagina");
    expect(ASSETS.fetch).toHaveBeenCalledOnce();
  });
});

describe("formulário livre", () => {
  it("pergunta nova em perguntas.js vai ao CRM sem mudar o contrato", async () => {
    const { montarLead } = await import("../index.js");
    const formulario = {
      versao: "teste",
      perguntas: [
        { chave: "patrimonio", tipo: "escolha", pergunta: "Patrimônio?", campo_crm: "patrimonio_faixa", opcoes: [{ chave: "a", rotulo: "A" }, { chave: "b", rotulo: "B" }] },
        { chave: "objetivo", tipo: "texto", pergunta: "Qual é o seu principal objetivo?" },
        { chave: "filhos", tipo: "inteiro", pergunta: "Quantos filhos?", sufixo: "filhos", opcional: true },
      ],
    };
    const corpo = corpoNavegador({ respostas: { patrimonio: "b", objetivo: "  Aposentar   cedo " } });
    const { erros, lead } = montarLead(corpo, {}, formulario);
    expect(erros).toEqual([]);
    expect(lead.campos.patrimonio_faixa).toBe("b");
    expect(lead.respostas).toEqual([
      { pergunta: "Patrimônio?", resposta: "B" },
      { pergunta: "Qual é o seu principal objetivo?", resposta: "Aposentar cedo" },
    ]);
  });
});
