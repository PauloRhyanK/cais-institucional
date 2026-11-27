import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { env } from "cloudflare:test";
import worker from "../index.js";

const SITE = "https://caisinvestimentos.com.br";
const ENV = { ...env, DB: env.DB, LIMITE_ENVIOS: undefined };

function chamar(caminho, { metodo = "GET", corpo, token, origem = SITE, ambiente = ENV } = {}) {
  const init = { method: metodo, headers: { Origin: origem } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(corpo);
  }
  return worker.fetch(new Request(SITE + caminho, init), ambiente, {});
}
const entrar = (usuario, senha, ambiente) => chamar("/eventos/api/login", { metodo: "POST", corpo: { usuario, senha }, ambiente });
const PRESENCA = {
  nome: "  Maria   Oliveira ",
  telefone: "(27) 98888-7777",
  telefone_numeros: "27988887777",
  email: " Maria@Exemplo.com ",
  cpf: "529.982.247-25",
  cpf_numeros: "52998224725",
  origem_url: SITE + "/evento-offshore/",
  user_agent: "teste",
};

afterEach(() => vi.useRealTimers());
const trocarSenha = (senha) =>
  env.DB.prepare("INSERT OR REPLACE INTO painel_usuarios (usuario, senha_hash) VALUES ('admin', ?)").bind(bcrypt.hashSync(senha, 6)).run();
beforeAll(async () => {
  expect((await entrar("admin", "senha-de-teste")).status).toBe(401); // banco vazio: cria as tabelas e nega
  await trocarSenha("senha-de-teste");
});

describe("POST /eventos/api/login", () => {
  it("aceita só o usuário e a senha certos", async () => {
    expect((await entrar("admin", "errada")).status).toBe(401);
    expect((await entrar("outro", "senha-de-teste")).status).toBe(401);
    expect((await entrar("", "")).status).toBe(401);
    const r = await entrar(" Admin ", "senha-de-teste");
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.usuario).toBe("admin");
    expect(corpo.token).toMatch(/^\d{13}\.61646d696e\.[0-9a-f]{64}$/);
  });

  it("a sessão vence, não pode ser adulterada e cai se a senha mudar", async () => {
    const { token } = await (await entrar("admin", "senha-de-teste")).json();
    const lista = (t, ambiente) => chamar("/eventos/api/offshore/confirmacoes", { token: t, ambiente });
    expect((await lista(token)).status).toBe(200);
    const [expira, , assinatura] = token.split(".");
    expect((await lista(`${Number(expira) + 1000}.61646d696e.${assinatura}`)).status).toBe(401);
    const [, usuario] = token.split(".");
    vi.useFakeTimers({ now: Number(expira) + 1, toFake: ["Date"] });
    expect((await lista(token)).status).toBe(401);
    vi.useRealTimers();
    await trocarSenha("senha-nova");
    expect((await lista(token)).status).toBe(401);
    expect((await entrar("admin", "senha-nova")).status).toBe(200);
    await trocarSenha("senha-de-teste");
    expect(usuario).toBe("61646d696e");
  });
});

describe("Evento Offshore", () => {
  it("confirma presença, normaliza e recusa CPF repetido com 409", async () => {
    const r = await chamar("/evento-offshore/api/confirmacoes", { metodo: "POST", corpo: PRESENCA });
    expect(r.status).toBe(201);
    const repetido = await chamar("/evento-offshore/api/confirmacoes", { metodo: "POST", corpo: { ...PRESENCA, nome: "Outra Pessoa" } });
    expect(repetido.status).toBe(409);
    const linhas = (await env.DB.prepare("SELECT * FROM offshore_confirmacoes").all()).results;
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ nome: "Maria Oliveira", email: "maria@exemplo.com", telefone_numeros: "27988887777", cpf_numeros: "52998224725" });
  });

  it("recusa dados inválidos e outra origem", async () => {
    const r = await chamar("/evento-offshore/api/confirmacoes", {
      metodo: "POST",
      corpo: { nome: "A", telefone: "x", telefone_numeros: "123", email: "sem-arroba", cpf: "1", cpf_numeros: "123" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).erro.campos).toEqual(["nome", "telefone", "email", "cpf"]);
    expect((await chamar("/evento-offshore/api/confirmacoes", { metodo: "POST", corpo: PRESENCA, origem: "https://outro.site" })).status).toBe(403);
  });

  it("painel lista e exclui confirmações só com sessão", async () => {
    expect((await chamar("/eventos/api/offshore/confirmacoes")).status).toBe(401);
    const { token } = await (await entrar("admin", "senha-de-teste")).json();
    const { confirmacoes } = await (await chamar("/eventos/api/offshore/confirmacoes", { token })).json();
    expect(confirmacoes).toHaveLength(1);
    expect(confirmacoes[0]).toMatchObject({ nome: "Maria Oliveira", telefone: "(27) 98888-7777", cpf: "529.982.247-25" });
    expect(confirmacoes[0].user_agent).toBeUndefined();

    const caminho = "/eventos/api/offshore/confirmacoes/" + confirmacoes[0].id;
    expect((await chamar(caminho, { metodo: "DELETE" })).status).toBe(401);
    expect((await chamar(caminho, { metodo: "DELETE", token })).status).toBe(200);
    expect((await (await chamar("/eventos/api/offshore/confirmacoes", { token })).json()).confirmacoes).toEqual([]);
  });

  it("gerador cria link nominal só com o token mestre", async () => {
    const criar = (corpo) => chamar("/evento-offshore/api/convites", { metodo: "POST", corpo });
    expect(await (await criar({ token_mestre: "errado", nome: "João Silva" })).json()).toEqual({ sucesso: false, erro: "Token mestre inválido." });
    const mestre = "d3cAJYoa772FatFo67GT";
    expect((await (await criar({ token_mestre: mestre, nome: " " })).json()).sucesso).toBe(false);
    const aleatorio = await (await criar({ token_mestre: mestre, nome: " João Silva " })).json();
    expect(aleatorio).toMatchObject({ sucesso: true, nome: "João Silva" });
    expect(aleatorio.token).toMatch(/^[0-9a-f]{7}$/);
    const proprio = await (await criar({ token_mestre: mestre, nome: "Ana Souza", token_customizado: " Ana.Souza!VIP " })).json();
    expect(proprio.token).toBe("anasouzavip");
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM offshore_convites").first();
    expect(n).toBe(2);
  });
});
