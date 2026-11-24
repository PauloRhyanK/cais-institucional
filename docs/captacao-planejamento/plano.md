# Plano — Página de captação "Quando você pretende viver de renda?"

Status: **proposta para aprovação** (nada implementado). Data: 2026-11-24.

## 0. O que existe hoje (verificado no código)

| Item | Onde | Fato |
|---|---|---|
| Site | `Cais-instituicional/` | HTML/CSS/JS estático, sem build, publicado no Cloudflare (`wrangler.json`, só assets). Formulário de contato via Web3Forms. **Não há link de política de privacidade.** |
| Referência "Convite da CAIS" | `evento-offshore/` | Convite privado do Evento Offshore: azul profundo `#081421`, ouro suave `#d9bd7e`, azul corporativo `#003b5c`, General Sans, grafismo de losangos (Manual da Marca p. 20/23). Usa Supabase próprio (`cais-evento-offshore`), fora do CRM. |
| CRM CAIS V2 | `CAISv2/` (configuração YAML + front React 19/Vite/react-aria) sobre o motor **Flow.ia** (`flowia/`, Node, Droplet + Caddy) | Modelos genéricos `registro`/`relacao`/`item`, moldes em `implantacao/fonte/moldes.yaml`, mudanças no ar por "correções" (`implantacao/correcoes/*.mjs`). |
| Ingestão de lead do site | Flow.ia `POST /v1/entrada/{conector}/lead`, canal `formulario_do_site` (`flowia/documentacao/api/04-sessao-ao-vivo-entrada.md` §5.2) | Autenticação por segredo (Bearer/X-Api-Key/HMAC), **sem CORS** → exige um intermediário no servidor. Idempotência por `id` + `site_lead_id` único. Payload `{id, enviado_em, pessoa{nome,telefone,email}, campos{≤50}, respostas[≤30]}`. |
| Deduplicação de Pessoa | `porta/src/entrada/lead.ts` | Telefone E.164 exato ou e-mail; Pessoa existente só recebe contato vazio; nome e `origem` originais são preservados. |
| Lead (Entrada) | molde `entrada` | `origem` (enum já tem `influenciador` e `landing`), `frente` (`investimentos`), `campanha`, `fonte`, `utm_source`, `utm_medium`, `pagina_do_site`, `respostas`. Chega sem dono → Funil › Leads → `liberado` → vendedores. Liga-se à oportunidade aberta da mesma frente, se existir. |
| Reprocessamento | Flow.ia `fila` (tentativas) | Erros do site (mal formado, sem contato) não são retentados; indisponibilidade do CRM no envio não é coberta do lado do site. |
| Links, influenciadores, eventos de conversão | — | **Não existem.** `campanha` no CRM é competição interna de vendas, não campanha de marketing. |
| Exibição no detalhe | bloco "Origem do lead" (`front/src/pecas/blocos/pessoas/origem-do-lead.tsx`) | Mostra respostas parseadas, mas só lista entradas com `anuncio_campanha` preenchido. |

## 1. Arquitetura proposta

> **Atualização 2026-11-24:** mantido o Worker do site, **sem outbox em D1**: o Worker valida e repassa direto ao Flow.ia, e o retry é do navegador. Contrato vigente: `contrato-recebimento.md`.

```
Navegador (/planejamento/…)  ──HTTPS──▶  Cloudflare Worker (mesmo domínio do site)
                                              │  resolve link, valida, normaliza, rate limit,
                                              │  outbox D1 + retry por Cron
                                              ▼
                                   Flow.ia /v1/entrada/{conector}/lead  ──▶  Pessoa + Entrada (Investimentos)
```

- O Worker é o backend confiável: guarda o segredo do conector (Wrangler secret), resolve o código do link e **define a atribuição oficial**; o navegador envia só o código.
- Persistência confiável = gravação no outbox D1 **ou** 200 do Flow.ia. Se o CRM falhar (5xx/429/timeout), o envio fica no D1 e um Cron reenvia com o mesmo `id` (idempotente). A tela de sucesso só aparece depois de uma das duas gravações.
- Alternativa considerada: reaproveitar o outbox Supabase `lead-sync` da landing Lovable. Rejeitada porque acopla a um projeto de terceiros e altera funcionalidade existente.

## 2. Site — componentes e telas (`Cais-instituicional/planejamento/`)

JS puro, como o `evento-offshore`, sem framework. `libphonenumber-js` (build "min") incluída como arquivo local.

- `index.html` + `styles.css` (tokens do Convite) + módulos `app.js` (máquina de etapas), `campos/telefone.js`, `campos/moeda.js`, `campos/idade.js`, `validacao.js` (compartilhada com o Worker), `eventos.js`.
- Telas: Início → 1 Patrimônio → 2 Experiência → 3 Aporte (barras crescentes em SVG) → 4 Idade → 5 Idade-alvo (linha do tempo) → 6 Renda (moeda + "Ainda não sei") → 7 Identificação → Finalização (resumo, sem diagnóstico). Telas extras: link indisponível e erro de envio.
- Uma pergunta por vez, cards `role="radio"` com setas do teclado, barra de progresso, "Etapa n de 7", voltar sem perder dados, transição respeitando `prefers-reduced-motion`. Mobile primeiro.
- Estado só em memória (nada financeiro ou pessoal no `localStorage`). Apenas `sessionStorage` com o id da sessão e o código do link.
- Rotas: `/planejamento/` (direto) e `/planejamento/r/{codigo}`.

## 3. Worker (`Cais-instituicional/worker/`)

- `GET /planejamento/r/{codigo}` → serve a página. `GET /planejamento/api/link/{codigo}` → `{ativo}` (sem dados internos).
- `POST /planejamento/api/envios` → valida tudo de novo, normaliza, monta o payload e grava no outbox.
- `POST /planejamento/api/eventos` → contadores sem PII.
- Proteções:
  - rate limit por IP truncado (/24, /48) ou com hash e janela curta, sem guardar o IP;
  - campo *honeypot* e tempo mínimo de preenchimento;
  - limite de tamanho;
  - Turnstile só se aparecer abuso (é uma pendência).
- Logs sem corpo de requisição.
- Tabelas D1:
  - `envios` (outbox, com expurgo depois de confirmado);
  - `links_cache` (espelho do CRM, ver §4);
  - `eventos_diarios` (agregados por link/dia/etapa).

## 4. CAIS V2 / Flow.ia — alterações

1. **Molde `parceiro`** (nome, tipo influenciador/parceiro, contato interno, ativo). É uma entidade nova porque nada no CRM a representa hoje. Pessoa é cliente; usá-la poluiria a deduplicação e o funil.
2. **Molde `link_de_captacao`**:
   - `codigo` (6 caracteres base32 sem ambíguos, único, gerado no servidor), `parceiro` (relação), `campanha` (texto, igual a `entrada.campanha`, para não duplicar o conceito), `canal`, `local`, `conteudo`, `ativo`;
   - contadores agregados vindos do Worker: visitas, sessões, inícios, concluídos, etapa alcançada e tempo médio.
3. **Campos novos em `entrada`**:
   - Respostas: `patrimonio_faixa`, `experiencia_faixa`, `aporte_faixa`, `idade_atual`, `idade_objetivo`, `horizonte_anos`, `renda_desejada_centavos`, `renda_desejada_indefinida`, `renda_anual_centavos`.
   - Atribuição: `link_de_captacao` (relação), `parceiro` (relação), `canal_divulgacao`, `local_divulgacao`, `conteudo_divulgacao`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `referencia_dominio`.
   - Envio: `form_versao`, `privacidade_versao`, `base_legal`, `duracao_segundos`, `dispositivo`, `sessao_id`.
   - As UTMs ficam em campos próprios e não sobrescrevem a atribuição oficial.
4. **Novo conector `formulario_do_site`, "Planejamento"**, com `campos_fixos`: `frente: investimentos` e `pagina_do_site`. `origem` é definida pelo Worker: `influenciador` com link, `landing` sem link. O conector da landing de consórcio não muda.
5. **Ficha**:
   - Bloco novo "Planejamento informado", com faixas e valores formatados e horizonte, sem JSON.
   - Restrito por permissão aos grupos comerciais e gestão, oculto para `marketing` e `tv`.
   - O filtro do bloco "Origem do lead" passa a aceitar entradas com link ou campanha.
6. **Tela "Links de captação"** em Configurações › Integrações (área já restrita a sócio/admin):
   - lista, criar, copiar URL, ativar/desativar;
   - leads por link (visão filtrada das entradas);
   - indicadores básicos.
   - Marketing vê só os agregados, sem dados de cliente (R8.3).
7. **Resolução de link no Worker.** O Worker consulta o CRM com credencial de serviço e guarda em cache por poucos minutos, para que desativar o link valha em minutos.
   - ⚠️ Ainda falta verificar se o Flow.ia expõe leitura e escrita de registros por credencial de serviço.
   - Se não expuser, o plano B é um endpoint mínimo no Flow.ia.
   - Os contadores sobem ao `link_de_captacao` por Cron diário.

## 5. Contrato Worker → Flow.ia

```json
{
  "id": "planejamento:<uuid-da-submissao>",
  "enviado_em": "<hora do servidor ISO>",
  "pessoa": { "nome": "Ana Souza", "telefone": "+5527999998888", "email": "ana+inv@ex.com" },
  "campos": {
    "origem": "influenciador", "link_de_captacao": "a7k2m9", "parceiro": "<id>",
    "campanha": "Independência financeira", "canal_divulgacao": "instagram",
    "local_divulgacao": "stories", "conteudo_divulgacao": "Vídeo sobre viver de renda",
    "utm_source": "...", "utm_medium": "...", "utm_campaign": "...", "utm_content": "...", "utm_term": "...", "utm_id": "...",
    "patrimonio_faixa": "acima_500k_ate_1m", "experiencia_faixa": "acima_3m_ate_12m", "aporte_faixa": "acima_10_ate_20",
    "idade_atual": 30, "idade_objetivo": 50, "horizonte_anos": 20,
    "renda_desejada_centavos": 1500000, "renda_desejada_indefinida": false, "renda_anual_centavos": 18000000,
    "form_versao": "planejamento-v1", "privacidade_versao": "<pendente>", "duracao_segundos": 94,
    "dispositivo": "mobile", "sessao_id": "<uuid>"
  },
  "respostas": [{ "pergunta": "Qual é o seu patrimônio atual?", "resposta": "Acima de R$ 500 mil até R$ 1 milhão" }]
}
```

- "Ainda não sei": `renda_desejada_indefinida: true`, e `renda_desejada_centavos` e `renda_anual_centavos` vão ausentes, nunca 0.
- Nenhum dado pessoal ou financeiro vai na URL ou nos eventos.

## 6. Regras de atribuição

- Com link ativo, o Worker resolve o código, e a origem, o parceiro, a campanha, o canal, o local e o conteúdo vêm do CRM. As UTMs são só registradas.
- Com link inexistente ou desativado, aparece a tela amigável "Este link não está mais disponível" com o botão "Preencher mesmo assim". Esse botão segue como acesso direto, sem atribuir o parceiro. O comportamento é pendência de negócio, e a alternativa é só a mensagem.
- Sem link: `origem: landing` e as UTMs disponíveis. Nunca se supõe um parceiro.
- Primeira origem: `pessoa.origem` existente nunca é sobrescrita (o Flow.ia já se comporta assim). Cada envio cria a própria Entrada, com o contexto do envio, o que dá a última origem.
- O código fica guardado só na sessão da aba. Se o código chegar adulterado, o Worker revalida e cai em "direto".

## 7. Validação e normalização (front e Worker, mesmo módulo)

- **Idade:** só inteiro (aceita colagem com espaços e rejeita "30,5" e "30a"), com as mensagens exatas da demanda. Idade-alvo ≥ idade atual, sem teto oculto. Horizonte 0 é permitido.
- **Idade mínima:** 18, **se confirmado**. Nesse caso a mensagem fica visível na etapa 4.
- **Nome:** trim e espaços colapsados. Aceita letras Unicode, espaço, hífen, apóstrofo e ponto. Exige pelo menos uma letra.
- **Telefone:** `libphonenumber-js` com país padrão BR e formatação "as you type", preservando o cursor.
  - Os 5 exemplos da demanda resultam em `+5527999998888`.
  - Os testes cobrem DDD 55 (`55 99999-8888` vira `+5555999998888`).
  - Número estrangeiro recebe a mensagem "No momento atendemos apenas números do Brasil", se a operação for só BR.
- **E-mail:** opcional, trim, validação RFC-pragmática que aceita `+`.
- **Moeda:** dígitos com formatação pt-BR (centavos implícitos). Colagem de "15.000", "15000,50" e "R$ 15.000,00" é interpretada corretamente. Valor deve ser > 0.
- **Erros:** aparecem ao sair do campo ou ao clicar em Continuar, nunca durante a digitação. Ao mudar a idade atual, a idade-alvo é revalidada.

## 8. Monitoramento

Os eventos ficam só em agregados no D1, sem PII e sem IP: `visita`, `inicio`, `etapa_n`, `tentativa_envio`, `falha_envio`, `concluido`, cada um com `sessao_id` e código do link.

- Crawlers e previews (WhatsApp, Facebook, Slack…) não executam JS, e o User-Agent de bots é filtrado.
- Nos indicadores do CRM, cada taxa mostra o seu denominador:
  - taxa de início = inícios ÷ sessões;
  - conclusão = concluídos ÷ inícios;
  - captação = concluídos ÷ sessões.
- Abandono por etapa é sessão iniciada sem conclusão depois de 24 h, rotulado como estimativa.
- Leads por parceiro e campanha, e a distribuição patrimonial, vêm do próprio CRM (entradas).
- Etapas comerciais posteriores (reuniões, oportunidades, clientes) reutilizam Análises › Captação.

## 9. Testes

- **Site:** Vitest (unitários de validação e normalização, compartilhados com o Worker) e Playwright mobile e desktop, cobrindo:
  - navegação, voltar e alterar, linha do tempo, 100 anos e idade-alvo menor;
  - espaços, colagem e autofill (simulado por eventos `input` sem `keydown`);
  - duplo clique, offline e 503 do CRM;
  - link inválido e desativado;
  - axe para acessibilidade e navegação só por teclado.
- **Worker:** `vitest` com `@cloudflare/vitest-pool-workers`, Flow.ia simulado (200, 409 e 503 com retry, mesmo `id` não duplica).
- **CAIS V2:** `node --test` em `implantacao` para moldes e correções, e `npm run verificar` em `front` (bloco da ficha e tela de links, testes de tela e de contrato).
- **Ponta a ponta:** Playwright contra o Worker local (`wrangler dev`) apontando para um ambiente Flow.ia de teste. Confere Pessoa nova, Pessoa existente (deduplicação por telefone), dois links do mesmo parceiro e dois parceiros diferentes.
- Autofill real em iOS e Android é teste manual com roteiro, porque não dá para automatizar de forma fiel.

## 10. Fases

1. Verificar a API de registros do Flow.ia (§4.7) e criar o ambiente de teste do conector.
2. CRM: moldes, campos, conector e bloco da ficha (correções versionadas).
3. Worker: envio, outbox e retry.
4. Página pública completa.
5. Links de captação: tela, resolução e indisponibilidade.
6. Eventos e indicadores.
7. E2E, roteiro manual mobile e documentação.

## 11. Pendências reais de negócio (bloqueiam a publicação, não o início)

1. **Faixas de experiência** (etapa 2): confirmar com o Raul.
2. **Idade mínima:** 18+?
3. **Base legal LGPD**, texto do aviso e **URL da política de privacidade**. O site não tem uma, e o aviso só vai para produção com a política publicada.
4. **Retenção:** prazo para leads não convertidos e para o outbox e os agregados.
5. **Telefones internacionais:** só Brasil?
6. **Link desativado:** "preencher como acesso direto" ou só a mensagem?
7. **Jornada no CRM:** a decisão de 20/11 ("cartão sem dono ao chegar") está no ar para Investimentos? Este plano não cria Oportunidade além do que a jornada vigente já faz.
8. **Quem cadastra parceiros e links:** só sócio/admin, ou também marketing?
9. **Referência visual:** confirmar que o "Convite da CAIS" é o `evento-offshore` (os PNGs "Convite" em Downloads são convites pessoais de aniversário).
10. **Domínio/rota final:** `caisinvestimentos.com.br/planejamento/r/{codigo}`?
