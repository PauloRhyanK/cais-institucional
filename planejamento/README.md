# Planejamento — página de captação de leads de Investimentos

Formulário conversacional ("Quando você pretende viver de renda?") para links de influenciadores e parceiros.
Visual baseado no convite do `evento-offshore`: azul profundo, ouro suave, General Sans e o grafismo do Manual da Marca.

## Rotas

| URL | Uso |
|---|---|
| `/planejamento/` | Acesso direto, sem influenciador. |
| `/planejamento/r/{codigo}` | Link de captação. O código (`[a-z0-9]{4,32}`) vai ao backend, que resolve a atribuição. |

Em produção (Cloudflare), a reescrita está em `/_redirects`. Localmente, `npx serve` lê `/serve.json`.

## Rodar e testar

```bash
npm run dev                      # só estáticos (envio simulado): http://localhost:3000/planejamento/
npm run dev:worker               # site + Worker (wrangler dev): http://localhost:8787/planejamento/?api=real
npm run test:planejamento        # unitários (node:test) das regras de validação e normalização
npm run test:worker              # Worker no runtime do Cloudflare (vitest + @cloudflare/vitest-plugin), CRM simulado
```

Em `localhost`, o envio é **simulado** e o corpo aparece no console:

- `?simular=falha` simula o backend fora do ar;
- `/planejamento/r/inativo` simula um link desativado.

## Arquivos

- `config.js`: endpoints e regras pendentes de decisão (idade mínima/máxima, só Brasil, política de privacidade, consentimento, link inativo).
- `js/nucleo.js`: regras puras, sem DOM. Roda também no Node e pode ser reaproveitado no backend para validar com as mesmas regras.
- `js/servicos.js`: verificação do link, envio idempotente e eventos sem dados pessoais.
- `js/app.js`: fluxo, máscaras de telefone e moeda, linha do tempo e resumo.
- `vendor/libphonenumber-min.js`: libphonenumber-js 1.13.17 (MIT), bundle UMD.

## Integração com o CRM

Fonte da verdade: [`docs/captacao-planejamento/contrato-recebimento.md`](../docs/captacao-planejamento/contrato-recebimento.md).

```
Navegador ──/planejamento/api/*──▶ Worker do site (worker/index.js) ──Bearer──▶ Flow.ia (CRM)
```

- O navegador chama o próprio domínio (`API_BASE = "/planejamento/api"`), sem CORS e sem segredo.
- O Worker (`worker/index.js`) guarda o segredo, valida de novo com as mesmas regras de `js/nucleo.js`, calcula `horizonte_anos` e `renda_anual_centavos` e monta o `LeadDoSite` com as chaves em ordem alfabética em todos os níveis. Campos vazios são omitidos.
  - O Worker **não guarda lead**.
  - O retry é do navegador, com o mesmo `id` e o mesmo corpo.
- Rotas do Worker:
  - `POST /planejamento/api/envios`, respondendo:
    - `200 {recebido:true}` quando o CRM confirma;
    - `409` quando o CRM devolve `recebido:false`;
    - `400 {erro:{campos:[…]}}` em erro de validação;
    - `429` com `Retry-After`;
    - `503` quando o CRM está fora do ar ou mal configurado.
  - `GET /planejamento/api/link/{codigo}`: devolve `{ativo}` com cache de 60 s; `503` se o CRM não responder.
  - `POST /planejamento/api/eventos`: sempre `204`; repassa ao CRM com `id` determinístico em `waitUntil`.
- O navegador:
  - congela o corpo por `id`;
  - com `409`, gera um `id` novo;
  - com `400`, volta à etapa do campo;
  - com `429`/`503`/rede, tenta de novo em 1 s, 3 s e 9 s e depois mostra "Tentar novamente".

### Configuração do Worker (Cloudflare)

```bash
npx wrangler secret put FLOWIA_PLANEJAMENTO_URL     # https://<host do CRM>/v1/entrada/<id do conector Planejamento>
npx wrangler secret put FLOWIA_PLANEJAMENTO_TOKEN   # segredo do conector (não passa por chat nem por repositório)
```

- Variáveis em `wrangler.json`:
  - `PLANEJAMENTO_IDADE_MINIMA` (18) e `PLANEJAMENTO_IDADE_MAXIMA` (120), pendentes de decisão;
  - rate limit `LIMITE_ENVIOS`: 10 envios por minuto por IP, com hash.
- Para desenvolver localmente, crie `.dev.vars` (ignorado pelo git) com as duas variáveis e rode `npm run dev:worker`. A página fica em `http://localhost:8787/planejamento/?api=real`.

### Chaves das alternativas (§7.1 do contrato: enviar ao CRM)

| Campo | Chave | Rótulo |
|---|---|---|
| `patrimonio_faixa` | `ate_100k` | Até R$ 100 mil |
| | `acima_100k_ate_500k` | Acima de R$ 100 mil até R$ 500 mil |
| | `acima_500k_ate_1m` | Acima de R$ 500 mil até R$ 1 milhão |
| | `acima_1m_ate_10m` | Acima de R$ 1 milhão até R$ 10 milhões |
| | `acima_10m` | Acima de R$ 10 milhões |
| `experiencia_faixa` (provisória, Raul) | `nao_investe` | Ainda não invisto |
| | `ate_3m` | Até 3 meses |
| | `acima_3m_ate_12m` | Acima de 3 meses até 12 meses |
| | `acima_12m` | Acima de 12 meses |
| `aporte_faixa` | `ate_10` | Até 10% |
| | `acima_10_ate_20` | Acima de 10% até 20% |
| | `acima_20_ate_30` | Acima de 20% até 30% |
| | `acima_30` | Acima de 30% |

## Privacidade

- As respostas ficam só em memória.
- O `sessionStorage` guarda apenas `sessao_id`, o código do link, as UTMs e o domínio de referência, e é apagado após o envio concluído.
- Sem cookies, fingerprinting ou ferramentas de terceiros.

## Pendências antes de publicar

Faixas de experiência (Raul), idade mínima e máxima, base legal com URL e versão da política de privacidade, só números do Brasil, comportamento do link desativado e endpoints reais.
Detalhes em `docs/captacao-planejamento/plano.md` §11.
