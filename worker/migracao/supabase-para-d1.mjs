/**
 * Migração única: copia os dados do Supabase (cais-evento-offshore) para o D1.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node worker/migracao/supabase-para-d1.mjs
 *   npx wrangler d1 execute cais-captacao --remote --file worker/migracao/dados.sql
 *
 * Gera worker/migracao/dados.sql (fora do git: contém dados pessoais).
 * Pode rodar de novo: usa INSERT OR IGNORE, então não duplica nem sobrescreve.
 */
import { writeFileSync } from "node:fs";
import { ESQUEMA } from "../eventos.js";

const URL_BASE = "https://laukfwrsdvchozgicjxm.supabase.co/rest/v1";
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!CHAVE) throw new Error("Defina SUPABASE_SERVICE_ROLE_KEY.");

async function ler(tabela) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    const r = await fetch(`${URL_BASE}/${tabela}?select=*`, {
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, Range: `${inicio}-${inicio + 999}` },
    });
    if (!r.ok) throw new Error(`${tabela}: ${r.status} ${await r.text()}`);
    const pagina = await r.json();
    linhas.push(...pagina);
    if (pagina.length < 1000) return linhas;
  }
}

const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const iso = (v) => (v ? new Date(v).toISOString() : null);

// Confirmações excluídas no painel antigo (deleted_at) ficam de fora.
const confirmacoes = (await ler("evento_offshore_confirmacoes")).filter((c) => !c.deleted_at);
const usuarios = await ler("evento_offshore_admin_users");
const convites = await ler("evento_offshore_acesso");

const linhas = [
  ...ESQUEMA.map((s) => s.replace(/\s+/g, " ") + ";"),
  ...usuarios.map((u) => `INSERT OR IGNORE INTO painel_usuarios (usuario, senha_hash) VALUES (${sql(u.username.toLowerCase())}, ${sql(u.password_hash)});`),
  ...confirmacoes.map(
    (c) =>
      `INSERT OR IGNORE INTO offshore_confirmacoes (id, nome, telefone, telefone_numeros, email, cpf, cpf_numeros, origem_url, user_agent, created_at) VALUES (${[
        c.id, c.nome, c.telefone, c.telefone_numeros, c.email, c.cpf, c.cpf_numeros, c.origem_url, c.user_agent, iso(c.created_at),
      ].map(sql).join(", ")});`
  ),
  ...convites.map(
    (c) =>
      `INSERT OR IGNORE INTO offshore_convites (token_sha256, ativo, convidado_nome, dados_evento, updated_at) VALUES (${[
        c.token_sha256, c.ativo ? 1 : 0, c.convidado_nome, c.dados_evento ? JSON.stringify(c.dados_evento) : null, iso(c.updated_at),
      ].map(sql).join(", ")});`
  ),
];

writeFileSync(new URL("./dados.sql", import.meta.url), linhas.join("\n") + "\n");
console.log(`confirmações: ${confirmacoes.length} · convites: ${convites.length} · usuários: ${usuarios.length} -> worker/migracao/dados.sql`);
