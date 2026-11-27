import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
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
