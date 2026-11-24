# Captação "Planejamento": contrato do site institucional com o CRM

Status: **proposta para aprovação**. Data: 24/11/2026. Origem: CAIS V2.

**Lado do site:** implementado e testado contra este contrato, com o CRM simulado. Ver `worker/index.js`, `worker/testes/worker.test.js` e `planejamento/README.md`.
**Lado do CRM:** as rotas `/ligacao/…` e `/evento` (§3 e §4) ainda serão criadas.

Este documento substitui a seção 5 (contrato Worker → Flow.ia) de `plano.md`. Ele também ajusta a seção 1, que **continua com o Worker, mas sem outbox em D1**. As demais seções do plano continuam valendo.

## 1. Arquitetura

```
Navegador (/planejamento/…)
   │  mesmo domínio, sem CORS: /planejamento/api/envios · /planejamento/api/link/{codigo} · /planejamento/api/eventos
   ▼
Cloudflare Worker do site  ── guarda o segredo do conector (Wrangler secret), valida de novo, normaliza,
   │                          calcula horizonte e renda anual, rate limit, honeypot. NÃO guarda lead.
   ▼
Flow.ia (CRM)  POST /v1/entrada/{conector Planejamento}/lead · GET …/ligacao/… · POST …/evento
   ▼
Pessoa (deduplicada) + Entrada (Investimentos) + ligação com o link + oportunidade/cartão da jornada vigente
```

- **O site não salva nenhum dado de lead**: nem D1, nem KV, nem Supabase, nem `localStorage`. A única gravação é no CRM.
- **O CRM confirma quando responde `200 {"recebido": true}`.** Esse 200 só sai depois que o Flow.ia gravou o envio na tabela `recebido` e o enfileirou. O lead está guardado, mesmo que a criação da Pessoa e da Entrada aconteça segundos depois.
- **Se o CRM estiver fora do ar**, quem tenta de novo é o navegador, sempre com o mesmo `id`. A pessoa vê a tela de erro com "Tentar de novo". Não existe retry em segundo plano.
- **Quem resolve o código do link é o CRM, na hora em que grava o lead.** O site manda só o código.
- O segredo do conector **nunca** vai para o navegador. Ele é entregue ao Worker como Wrangler secret (`FLOWIA_PLANEJAMENTO_TOKEN`), junto com a URL (`FLOWIA_PLANEJAMENTO_URL`).

## 2. Worker → CRM: enviar o lead (existe hoje)

`POST https://<host do CRM>/v1/entrada/<id do conector Planejamento>/lead`

O host e o id do conector são passados pelo CRM quando o conector for criado.

### Cabeçalhos

```
Authorization: Bearer <FLOWIA_PLANEJAMENTO_TOKEN>
Content-Type: application/json
```

### Corpo

O corpo segue o `LeadDoSite`, que é estrito: chave desconhecida dá `400`.

```json
{
  "id": "planejamento:6f1c0b9e-2d7a-4c1e-9d0b-5a3e8f2c7b11",
  "pessoa": { "nome": "Ana Souza", "telefone": "+5527999998888", "email": "ana+inv@exemplo.com" },
  "campos": {
    "link_de_captacao": "a7k2m9",
    "patrimonio_faixa": "acima_500k_ate_1m",
    "experiencia_faixa": "acima_3m_ate_12m",
    "aporte_faixa": "acima_10_ate_20",
    "idade_atual": 30,
    "idade_objetivo": 50,
    "horizonte_anos": 20,
    "renda_desejada_centavos": 1500000,
    "renda_anual_centavos": 18000000,
    "utm_source": "instagram", "utm_medium": "stories", "utm_campaign": "...", "utm_content": "...", "utm_term": "...", "utm_id": "...",
    "form_versao": "planejamento-v1",
    "privacidade_versao": "2026-11-xx",
    "duracao_segundos": 94,
    "dispositivo": "mobile",
    "sessao_id": "3b2f9a4e-8c1d-4f6a-b7e2-1d9c0a5f3e88",
    "site_de_origem": "instagram.com"
  }
}
```

### Regras do corpo

| Campo | Regra |
|---|---|
| `id` | `planejamento:` + o uuid v4 que o navegador gerou para esse conteúdo. Até 200 caracteres. |
| Mesmo corpo no retry | **O retry precisa mandar o mesmo corpo, byte a byte.** O CRM compara a impressão SHA-256 dos bytes. Para isso: serialize com as chaves em ordem alfabética, em todos os níveis; **não mande `enviado_em`**, porque a hora mudaria a cada tentativa; e omita todo campo vazio. |
| Vazio | O CRM recusa `null`. Campo sem valor é **omitido**: e-mail vazio, UTM vazia, `link_de_captacao` no acesso direto. |
| Valores | String de até 2000 caracteres, number ou boolean. Nada de objeto ou array dentro de `campos`. Máximo de 50 chaves. |
| `pessoa.nome` | Trim e espaços colapsados, de 2 a 300 caracteres. |
| `pessoa.telefone` | E.164. Sem telefone e sem e-mail válidos, o lead é descartado do lado do CRM, por isso o Worker valida antes. |
| `link_de_captacao` | O código como veio da URL, em minúsculas, no formato `^[a-z0-9]{4,16}$`. O Worker **não** resolve o código. |
| `*_faixa` | Uma das chaves fechadas da lista do site (§7). Uma chave que o CRM não conhece é descartada em silêncio, então as listas precisam estar combinadas antes. |
| Idades e horizonte | Inteiros, com `idade_objetivo ≥ idade_atual` e `horizonte_anos = idade_objetivo − idade_atual`. |
| Renda | Mande **ou** `renda_desejada_centavos` (renda mensal, inteiro > 0) e `renda_anual_centavos` (mensal × 12), **ou** `renda_desejada_indefinida: true`. Nunca mande `0` nem as duas formas juntas. |
| `site_de_origem` | É o `referencia_dominio`: só o domínio do referrer. Ele usa um campo que já existe na entrada. |
| Fica de fora | `origem`, parceiro, campanha, canal, local, conteúdo e `respostas` (pergunta/resposta). A atribuição é do CRM, e os valores financeiros vão só em campos estruturados. |

### Respostas do CRM e o que o Worker faz

| Status | Corpo | Worker → navegador |
|---|---|---|
| `200` | `{"recebido": true, "numero": "planejamento:…"}` | Sucesso, inclusive no retry com o mesmo corpo. **Libera a tela de sucesso.** |
| `200` | `{"recebido": false, "numero": …}` | Mesmo `id` com outro corpo. Responde `409 ENVIO_DIFERENTE` ao navegador, que gera um `id` novo. |
| `400` | `{"erro":{"codigo":"ENVIO_MAL_FORMADO",…}}` | Bug do Worker. Responde `400` e não tenta de novo. |
| `403` / `404` | `SEM_PERMISSAO` / conector desligado ou inexistente | Configuração (segredo, conector desligado). Responde `503` ao navegador e registra no log só o status. |
| `429` | `LIMITE` + `Retry-After` | Repassa `429` com `Retry-After`. |
| `5xx`, timeout de 10 s, rede | qualquer um | Até 2 tentativas rápidas dentro do pedido (0,5 s e 2 s). Se não der, responde `503` e o navegador tenta de novo com o mesmo `id`. |

## 3. Worker → CRM: "o link está ativo?" (a criar no CRM)

`GET https://<host do CRM>/v1/entrada/<id do conector>/ligacao/link_de_captacao/<codigo>`, com o mesmo `Authorization: Bearer`.

- `200 {"ativo": true}` ou `200 {"ativo": false}`. Código inexistente e desativado respondem igual, e nenhum outro dado sai.
- O Worker guarda a resposta em cache por 60 s e a expõe ao navegador em `/planejamento/api/link/{codigo}`.
- Se o CRM não responder, o site **segue com o formulário normal e manda o código mesmo assim**. A decisão é sempre do CRM, quando grava.

## 4. Worker → CRM: eventos de navegação (a criar no CRM)

`POST https://<host do CRM>/v1/entrada/<id do conector>/evento`, com o mesmo `Authorization: Bearer`.

```json
{ "id": "evento:<sessao_id>:etapa:3", "sessao_id": "<uuid>", "link": "a7k2m9", "evento": "etapa", "etapa": 3, "form_versao": "planejamento-v1" }
```

- `evento` é um destes: `visita`, `inicio`, `etapa` (com `etapa` de 1 a 7), `tentativa_envio`, `falha_envio` ou `concluido`.
- `link` é omitido no acesso direto.
- O `id` é determinístico, `evento:<sessao>:<evento>[:<etapa>]`. Assim, o mesmo evento da mesma sessão conta uma vez só.
- O CRM soma os eventos nos contadores do link, que alimentam a tela "Links de captação".
- Do navegador para o Worker: `navigator.sendBeacon('/planejamento/api/eventos', …)`. O Worker responde sempre `204` e repassa ao CRM em `ctx.waitUntil`. Se o repasse falhar, o evento se perde: é métrica, não lead.
- **Nada pessoal nem financeiro entra no evento.** O Worker descarta User-Agents de bot.

## 5. Navegador ↔ Worker

As rotas e o formato entre o navegador e o Worker são do site. As regras são estas:

- O `id` (uuid v4) é gerado **uma vez para o conteúdo enviado**. Duplo clique e "Tentar de novo" reaproveitam o mesmo. Se a pessoa mudar uma resposta depois de uma falha, o navegador gera um `id` novo.
- **A tela de sucesso só aparece depois que o CRM respondeu `recebido: true`.**
- Erros `400` voltam para a etapa do campo e nunca ecoam valores. Com `409`, o navegador gera um `id` novo e reenvia. Com `429` ou `503`, tenta de novo com o mesmo `id`: até 3 vezes, em 1 s, 3 s e 9 s, e depois a tela de erro.
- Logs do Worker só com metadados: status e duração. Nunca o corpo da requisição.

Formato usado pelo site, documentado em `planejamento/README.md`:

```json
{
  "id": "<uuid>",
  "link": "a7k2m9",
  "pessoa": { "nome": "...", "telefone": "+55...", "email": "..." },
  "respostas": {
    "patrimonio_faixa": "...", "experiencia_faixa": "...", "aporte_faixa": "...",
    "idade_atual": 30, "idade_objetivo": 50,
    "renda_desejada_centavos": 1500000
  },
  "utm": { "utm_source": "..." },
  "envio": {
    "form_versao": "...", "privacidade_versao": "...", "duracao_segundos": 94,
    "dispositivo": "mobile", "sessao_id": "<uuid>", "referencia_dominio": "..."
  },
  "site": ""
}
```

Em vez de `renda_desejada_centavos`, a renda pode vir como `renda_desejada_indefinida: true`.

## 6. Atribuição: o que acontece no CRM

| Caso | Entrada no CRM |
|---|---|
| Link ativo | `origem = influenciador`. A entrada fica ligada ao link e, por ele, ao parceiro. Campanha, canal, local e conteúdo são copiados do cadastro do link no momento da gravação. |
| Link inexistente ou desativado | `origem = landing`, sem link e sem parceiro. |
| Acesso direto | `origem = landing`. |
| Sempre | `frente = investimentos` e `pagina_do_site = /planejamento/`. As UTMs ficam em campos próprios e não mudam a atribuição. |

- **Pessoa existente**, achada por telefone ou e-mail: o nome e a origem originais não mudam, e cada envio vira **uma entrada nova**, com a própria atribuição.
- **Jornada:** a mesma dos leads de tráfego, no ar desde 20/11/2026. Se a pessoa já tem oportunidade aberta em Investimentos, a entrada se liga a ela. Se não tem, nasce uma oportunidade com cartão sem dono em Investimentos › Recebido.

## 7. O que o site precisa entregar ao CRM antes da publicação

1. As listas fechadas de chaves e rótulos de `patrimonio_faixa`, `aporte_faixa` e `experiencia_faixa`. Estão em `planejamento/README.md`.
2. A `privacidade_versao` e a URL da política de privacidade, quando existirem. **Pendente.**

O que o CRM entrega ao site:
- o host;
- o id do conector;
- o segredo, que vai direto para o Wrangler secret (`wrangler secret put`) e não passa por chat nem por repositório.

## 8. Testes do lado do site

Os testes rodam com Vitest e `@cloudflare/vitest-plugin`, sucessor do `@cloudflare/vitest-pool-workers`, que foi descontinuado. O CRM é simulado. O comando é `npm run test:worker`, e todos os casos abaixo estão cobertos:

- `200 recebido:true` duas vezes com o mesmo `id`: uma tela de sucesso, e os bytes do corpo são idênticos nas duas.
- `503` e depois `200`: o mesmo `id`.
- `200 recebido:false`: `409` ao navegador e `id` novo.
- `400`: sem retry.
- `403`: `503` ao navegador.
- Acesso direto: sem `link_de_captacao`.
- E-mail vazio: chave omitida.
- "Ainda não sei": só `renda_desejada_indefinida: true`.
- Link com `ativo:false`: tela de link indisponível.
- Ligação fora do ar: o formulário segue normal.

## 9. Pendências de negócio (abertas, nada no acervo responde)

1. Faixas de experiência: confirmar com o Raul.
2. Idade mínima de 18 anos.
3. Base legal LGPD, texto do aviso e URL da política de privacidade. Sem a política publicada, a página não vai para produção.
4. Retenção dos leads não convertidos.
5. Só telefones do Brasil?
6. Link desativado: "Preencher mesmo assim" como acesso direto, ou só a mensagem?
7. Quem cadastra parceiros e links: só sócio/admin, ou também marketing?
8. Domínio e rota finais.
