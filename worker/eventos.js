/**
 * Eventos — tudo que antes ficava no Supabase, agora no D1 (binding DB).
 *
 * Painel (/eventos/admin/):
 *   POST   /eventos/api/login                        { usuario, senha } -> { token, usuario }
 *   GET    /eventos/api/offshore/confirmacoes        (sessão)
 *   DELETE /eventos/api/offshore/confirmacoes/{id}   (sessão)
 * Evento Offshore (páginas públicas):
 *   POST   /evento-offshore/api/confirmacoes         confirmação de presença
 *   POST   /evento-offshore/api/convites             link nominal (gerador, com o token mestre)
 *
 * Usuários do painel ficam na tabela painel_usuarios (senha em bcrypt, como era no Supabase).
 * A sessão é um token assinado com o hash da senha: trocar a senha encerra as sessões do usuário.
 */
import bcrypt from "bcryptjs";

export const PREFIXOS_EVENTOS = ["/eventos/api/", "/evento-offshore/api/"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_CORPO = 8 * 1024;
const SESSAO_MS = 7 * 24 * 60 * 60 * 1000;
// SHA-256 do token mestre do gerador de convites (o mesmo que já está em gerador.html).
const MESTRE_SHA256 = "066eaf62b154cc9e57bed5087eb0656f0d1c7c3f4dd895da9ace331e5739d64f";

export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS offshore_confirmacoes (
     id               TEXT PRIMARY KEY,
     nome             TEXT NOT NULL,
     telefone         TEXT NOT NULL,
     telefone_numeros TEXT NOT NULL,
     email            TEXT NOT NULL,
     cpf              TEXT NOT NULL,
     cpf_numeros      TEXT NOT NULL UNIQUE,
     origem_url       TEXT,
     user_agent       TEXT,
     created_at       TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_offshore_confirmacoes_created_at ON offshore_confirmacoes (created_at)`,
  `CREATE TABLE IF NOT EXISTS offshore_convites (
     token_sha256   TEXT PRIMARY KEY,
     ativo          INTEGER NOT NULL DEFAULT 1,
     convidado_nome TEXT,
     dados_evento   TEXT,
     updated_at     TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS painel_usuarios (
     usuario    TEXT PRIMARY KEY,
     senha_hash TEXT NOT NULL
   )`,
];
// Usado quando o usuário não existe, para o login levar o mesmo tempo nos dois casos.
const HASH_FALSO = "$2b$06$1woSNyu1iQve657gNfPi6eeX7901752tl1Mp0BcuerODYK0gDL8wm";

/** Roda `fn`; se as tabelas ainda não existem, cria e tenta de novo. */
async function comTabelas(env, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
    await env.DB.batch(ESQUEMA.map((sql) => env.DB.prepare(sql)));
    return await fn();
  }
}

export async function atenderEventos(request, url, env) {
  const origem = request.headers.get("Origin");
  if (origem && origem !== url.origin) return json(403, { erro: { codigo: "ORIGEM_NAO_PERMITIDA" } });

  const c = url.pathname;
  if (c === "/eventos/api/login") return soMetodo(request, "POST") || login(request, env);
  if (c === "/evento-offshore/api/confirmacoes") return soMetodo(request, "POST") || confirmar(request, env);
  if (c === "/evento-offshore/api/convites") return soMetodo(request, "POST") || criarConvite(request, env);
  if (c === "/eventos/api/offshore/confirmacoes") return soMetodo(request, "GET") || listarConfirmacoes(request, env);
  const excluir = /^\/eventos\/api\/offshore\/confirmacoes\/([^/]+)$/.exec(c);
  if (excluir) return soMetodo(request, "DELETE") || excluirConfirmacao(request, env, excluir[1]);
  return json(404, { erro: { codigo: "NAO_ENCONTRADO" } });
}

// ======================================================================
// Sessão do painel
// ======================================================================
async function login(request, env) {
  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });
  if (await limitado(request, env, "login")) return json(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": "60" });
  const corpo = await lerCorpo(request);
  if (!corpo) return json(400, { erro: { codigo: "ENVIO_INVALIDO" } });

  const usuario = typeof corpo.usuario === "string" ? corpo.usuario.trim().toLowerCase() : "";
  const senha = typeof corpo.senha === "string" ? corpo.senha.slice(0, 200) : "";
  const hash = await hashDoUsuario(env, usuario);
  let confere = false;
  try {
    confere = bcrypt.compareSync(senha, hash || HASH_FALSO);
  } catch (_) {}
  if (!hash || !confere) return json(401, { erro: { codigo: "CREDENCIAIS_INVALIDAS" } });

  const expira = Date.now() + SESSAO_MS;
  return json(200, { token: `${expira}.${hexDeTexto(usuario)}.${await assinar(hash, usuario, expira)}`, usuario });
}

/** true quando o pedido traz um token de sessão do painel válido e não vencido. */
export async function sessaoValida(request, env) {
  if (!env.DB) return false;
  const m = /^Bearer\s+(\d{13})\.((?:[0-9a-f]{2}){1,64})\.([0-9a-f]{64})$/.exec(request.headers.get("Authorization") || "");
  if (!m || Number(m[1]) < Date.now()) return false;
  const usuario = new TextDecoder().decode(new Uint8Array(m[2].match(/../g).map((h) => parseInt(h, 16))));
  const hash = await hashDoUsuario(env, usuario);
  return !!hash && iguais(m[3], await assinar(hash, usuario, m[1]));
}

async function hashDoUsuario(env, usuario) {
  if (!usuario || usuario.length > 64) return null;
  const linha = await comTabelas(env, () => env.DB.prepare("SELECT senha_hash FROM painel_usuarios WHERE usuario = ?").bind(usuario).first());
  return linha ? linha.senha_hash : null;
}

async function assinar(hash, usuario, expira) {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(`sessao-painel:${hash}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", chave, enc.encode(`${usuario}|${expira}`)));
}

const hexDeTexto = (texto) => hex(new TextEncoder().encode(texto));

/** Comparação em tempo constante (sobre os resumos, para tamanhos diferentes). */
async function iguais(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let dif = 0;
  for (let i = 0; i < u.length; i++) dif |= u[i] ^ v[i];
  return dif === 0;
}

// ======================================================================
// Painel: confirmações do Evento Offshore
// ======================================================================
async function listarConfirmacoes(request, env) {
  if (!(await sessaoValida(request, env))) return json(401, { erro: { codigo: "NAO_AUTORIZADO" } });
  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });
  const { results } = await comTabelas(env, () =>
    env.DB.prepare(
      `SELECT id, nome, telefone, telefone_numeros, email, cpf, cpf_numeros, created_at
       FROM offshore_confirmacoes ORDER BY created_at DESC`
    ).all()
  );
  return json(200, { confirmacoes: results });
}

async function excluirConfirmacao(request, env, bruto) {
  if (!(await sessaoValida(request, env))) return json(401, { erro: { codigo: "NAO_AUTORIZADO" } });
  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });
  const id = bruto.toLowerCase();
  if (!UUID.test(id)) return json(400, { erro: { codigo: "ID_INVALIDO" } });
  await comTabelas(env, () => env.DB.prepare("DELETE FROM offshore_confirmacoes WHERE id = ?").bind(id).run());
  return json(200, { excluido: true });
}

// ======================================================================
// Público: confirmação de presença
// ======================================================================
async function confirmar(request, env) {
  if (await limitado(request, env, "offshore")) return json(429, { erro: { codigo: "LIMITE" } }, { "Retry-After": "60" });
  const corpo = await lerCorpo(request);
  if (!corpo) return json(400, { erro: { codigo: "ENVIO_INVALIDO", campos: ["corpo"] } });

  const txt = (v) => (typeof v === "string" ? v.trim() : "");
  const nome = txt(corpo.nome).replace(/\s+/g, " ");
  const telefone = txt(corpo.telefone);
  const telefoneNumeros = txt(corpo.telefone_numeros);
  const email = txt(corpo.email).toLowerCase();
  const cpf = txt(corpo.cpf);
  const cpfNumeros = txt(corpo.cpf_numeros);
  const erros = [];
  if (nome.length < 2 || nome.length > 200) erros.push("nome");
  if (!telefone || telefone.length > 30 || !/^\d{10,11}$/.test(telefoneNumeros)) erros.push("telefone");
  if (email.length > 254 || !EMAIL.test(email)) erros.push("email");
  if (!cpf || cpf.length > 18 || !/^\d{11}$/.test(cpfNumeros)) erros.push("cpf");
  if (erros.length) return json(400, { erro: { codigo: "ENVIO_INVALIDO", campos: erros } });
  if (!env.DB) return json(503, { erro: { codigo: "INDISPONIVEL" } });

  const opcional = (v) => txt(v).slice(0, 1000) || null;
  try {
    await comTabelas(env, () =>
      env.DB.prepare(
        `INSERT INTO offshore_confirmacoes
           (id, nome, telefone, telefone_numeros, email, cpf, cpf_numeros, origem_url, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), nome, telefone, telefoneNumeros, email, cpf, cpfNumeros, opcional(corpo.origem_url), opcional(corpo.user_agent), new Date().toISOString())
        .run()
    );
  } catch (e) {
    // CPF já confirmado: a página trata o 409 como "presença já confirmada".
    if (/UNIQUE constraint failed/i.test(String(e && e.message))) return json(409, { erro: { codigo: "JA_CONFIRMADO" } });
    throw e;
  }
  return json(201, { recebido: true });
}

// ======================================================================
// Gerador: link nominal de convite
// ======================================================================
async function criarConvite(request, env) {
  if (await limitado(request, env, "convites")) return json(429, { sucesso: false, erro: "Muitas tentativas. Aguarde um minuto." }, { "Retry-After": "60" });
  const corpo = (await lerCorpo(request)) || {};
  const mestre = typeof corpo.token_mestre === "string" ? corpo.token_mestre : "";
  if (!(await iguais(await sha256(mestre), MESTRE_SHA256))) return json(200, { sucesso: false, erro: "Token mestre inválido." });

  const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
  if (nome.length < 2 || nome.length > 200) return json(200, { sucesso: false, erro: "Nome do convidado é obrigatório." });

  const personalizado = typeof corpo.token_customizado === "string" ? corpo.token_customizado.trim() : "";
  let token = personalizado.length >= 3 ? personalizado.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 64) : "";
  if (!token) token = hex(crypto.getRandomValues(new Uint8Array(4))).slice(0, 7);
  if (!env.DB) return json(503, { sucesso: false, erro: "Serviço indisponível." });

  const hash = await sha256(token);
  await comTabelas(env, () =>
    env.DB.prepare(
      `INSERT INTO offshore_convites (token_sha256, ativo, convidado_nome, updated_at) VALUES (?, 1, ?, ?)
       ON CONFLICT (token_sha256) DO UPDATE SET convidado_nome = excluded.convidado_nome, ativo = 1, updated_at = excluded.updated_at`
    )
      .bind(hash, nome, new Date().toISOString())
      .run()
  );
  return json(200, { sucesso: true, token, nome });
}

// ======================================================================
// Utilitários
// ======================================================================
async function lerCorpo(request) {
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_CORPO) return null;
  try {
    const corpo = JSON.parse(new TextDecoder().decode(bytes));
    return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo : null;
  } catch (_) {
    return null;
  }
}

async function limitado(request, env, escopo) {
  if (!env.LIMITE_ENVIOS) return false;
  const { success } = await env.LIMITE_ENVIOS.limit({ key: `${escopo}:${request.headers.get("CF-Connecting-IP") || ""}` });
  return !success;
}

async function sha256(texto) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function soMetodo(request, metodo) {
  return request.method === metodo ? null : json(405, { erro: { codigo: "METODO_NAO_PERMITIDO" } }, { Allow: metodo });
}

export function json(status, corpo, cabecalhos) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cabecalhos || {}) },
  });
}
