import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import bcrypt from "bcryptjs";
import worker from "../index.js";

const SITE = "https://caisinvestimentos.com.br";
const ID = "6f1c0b9e-2d7a-4c1e-9d0b-5a3e8f2c7b11";
const ID2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function cadastrar(corpo, { cabecalhos = {}, metodo = "POST" } = {}) {
  const init = { method: metodo, headers: { Origin: SITE, "Content-Type": "application/json", ...cabecalhos } };
  if (metodo === "POST") init.body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return worker.fetch(new Request(SITE + "/gymclub/api/cadastros", init), env, {});
}
const linhas = async () => (await env.DB.prepare("SELECT * FROM cadastros_eventos ORDER BY recebido_em").all()).results;

describe("POST /gymclub/api/cadastros", () => {
  it("cria a tabela no primeiro cadastro e grava com dados normalizados", async () => {
    const r = await cadastrar({
      id: ID,
      colaborador: " Victor  Kiefer ",
      nome: "  Ana   Souza ",
      telefone: "(27) 99999-8888",
      email: " Ana@Exemplo.com ",
      observacoes: " Quer falar sobre previdência ",
      criado_em: "2026-11-28T14:00:00.000Z",
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ recebido: true });
    const [linha, ...resto] = await linhas();
    expect(resto).toHaveLength(0);
    expect(linha).toMatchObject({
      id: ID,
      evento: "gymclub",
      colaborador: "Victor Kiefer",
      nome: "Ana Souza",
      telefone: "+5527999998888",
      email: "ana@exemplo.com",
      observacoes: "Quer falar sobre previdência",
      criado_em: "2026-11-28T14:00:00.000Z",
    });
    expect(linha.recebido_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reenvio do mesmo id não duplica nem sobrescreve", async () => {
    const r = await cadastrar({ id: ID, colaborador: "Victor Kiefer", nome: "Outro Nome", telefone: "27999998888" });
    expect(r.status).toBe(200);
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0].nome).toBe("Ana Souza");
  });

  it("aceita só e-mail ou só telefone; observações são opcionais", async () => {
    expect((await cadastrar({ id: ID2, colaborador: "Victor Kiefer", nome: "Bruno Lima", telefone: "", email: "bruno@exemplo.com" })).status).toBe(200);
    const linha = (await linhas()).find((l) => l.id === ID2);
    expect(linha).toMatchObject({ telefone: null, email: "bruno@exemplo.com", observacoes: null, criado_em: null });
  });

  it("recusa dados inválidos apontando os campos, sem gravar", async () => {
    const antes = (await linhas()).length;
    const r = await cadastrar({ id: "x", colaborador: "", nome: "", telefone: "123", email: "sem-arroba", observacoes: "a".repeat(1001) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro.campos).toEqual(["id", "colaborador", "nome", "telefone", "email", "observacoes"]);
    const semContato = await cadastrar({ id: ID2, colaborador: "Victor Kiefer", nome: "Carla Dias" });
    expect((await semContato.json()).erro.campos).toEqual(["contato"]);
    expect((await cadastrar("{nao é json")).status).toBe(400);
    expect(await linhas()).toHaveLength(antes);
  });

  it("recusa outra origem, outro formato e outro método", async () => {
    const corpo = { id: ID, colaborador: "Victor Kiefer", nome: "Ana Souza", telefone: "27999998888" };
    expect((await cadastrar(corpo, { cabecalhos: { Origin: "https://outro.site" } })).status).toBe(403);
    expect((await cadastrar(corpo, { cabecalhos: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await cadastrar(null, { metodo: "GET" })).status).toBe(405);
  });
});

describe("/gymclub/api/admin/cadastros", () => {
  const ENV = { ...env, DB: env.DB };
  let sessao;
  beforeAll(async () => {
    const entrar = () =>
      worker.fetch(
      new Request(SITE + "/eventos/api/login", {
        method: "POST",
        headers: { Origin: SITE, "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: "admin", senha: "senha-de-teste" }),
      }),
        ENV,
        {}
      );
    await entrar(); // cria as tabelas
    await env.DB.prepare("INSERT OR REPLACE INTO painel_usuarios (usuario, senha_hash) VALUES ('admin', ?)").bind(bcrypt.hashSync("senha-de-teste", 6)).run();
    sessao = (await (await entrar()).json()).token;
  });

  function admin(caminho, { metodo = "GET", token, origem = SITE } = {}) {
    const headers = { Origin: origem };
    if (token) headers.Authorization = `Bearer ${token}`;
    return worker.fetch(new Request(SITE + "/gymclub/api/admin/cadastros" + caminho, { method: metodo, headers }), ENV, {});
  }

  it("sem sessão válida do painel não lista nem exclui", async () => {
    expect((await admin("")).status).toBe(401);
    expect((await admin("", { token: "token-qualquer" })).status).toBe(401);
    const adulterado = sessao.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect((await admin("/" + ID, { metodo: "DELETE", token: adulterado })).status).toBe(401);
    expect(await linhas()).toHaveLength(2);
  });

  it("com sessão válida lista os cadastros e exclui por id", async () => {
    const r = await admin("", { token: sessao });
    expect(r.status).toBe(200);
    const { cadastros } = await r.json();
    expect(cadastros.map((c) => c.nome).sort()).toEqual(["Ana Souza", "Bruno Lima"]);
    expect(cadastros.find((c) => c.id === ID)).toMatchObject({ colaborador: "Victor Kiefer", telefone: "+5527999998888" });

    expect((await admin("/nao-e-uuid", { metodo: "DELETE", token: sessao })).status).toBe(400);
    const apagar = await admin("/" + ID, { metodo: "DELETE", token: sessao });
    expect(await apagar.json()).toEqual({ excluido: true });
    expect((await linhas()).map((l) => l.id)).toEqual([ID2]);
  });

  it("recusa outra origem e outro método", async () => {
    expect((await admin("", { token: sessao, origem: "https://outro.site" })).status).toBe(403);
    expect((await admin("", { metodo: "POST", token: sessao })).status).toBe(405);
  });
});
