/**
 * ============================================================================
 * PERGUNTAS DO FORMULÁRIO "PLANEJAMENTO" — edite aqui.
 * ============================================================================
 * O site monta as telas a partir desta lista e o Worker valida com ela.
 * Ao CRM vai a lista de perguntas e respostas legíveis (como nas outras
 * campanhas), então adicionar, editar, reordenar ou tirar perguntas
 * NÃO exige mudança no CAIS V2.
 *
 * Única exceção: perguntas com `campo_crm` viram também um campo fixo no CRM
 * (hoje só o patrimônio, usado em filtros e gráficos). Se mudar as chaves das
 * opções dessas perguntas, avise o CAIS V2.
 *
 * Ao mudar perguntas, aumente `versao` (fica registrada em cada lead).
 *
 * Tipos:
 *   escolha  → cartões clicáveis. `opcoes: [{ chave, rotulo, icone? }]`.
 *              `icones: "barras"` desenha barras crescentes automaticamente.
 *   idade    → número inteiro em anos. `minimo`, `maximo`, `minimoDe` (outra pergunta).
 *   inteiro  → número inteiro genérico. `sufixo` (ex.: "filhos"), `minimo`, `maximo`.
 *   moeda    → valor em reais. `naoSei: "Ainda não sei"` habilita a opção;
 *              `anual: true` acrescenta a resposta derivada "por ano" (× 12).
 *   texto    → texto curto livre. `maximo` (caracteres).
 *
 * Comuns: `chave` (única, minúsculas e _), `pergunta`, `apoio` (opcional),
 *         `resumo` (rótulo na tela final; `false` = não aparece no resumo),
 *         `opcional: true` (pode pular),
 *         `placeholder`, `mensagens` (personaliza erros; ver exemplos abaixo).
 *
 * Ícones disponíveis para `escolha`: moeda, moedas, grafico, predio, diamante,
 * broto, calendario, calendario_cheio, tendencia, alvo, casa, escudo, relogio,
 * instagram, pessoa, pessoas.
 * ============================================================================
 */
(function (raiz, fabrica) {
  const formulario = fabrica();
  if (typeof module === "object" && module.exports) module.exports = formulario;
  else raiz.CAIS_PLANEJAMENTO_FORMULARIO = formulario;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    versao: "planejamento-v4",

    inicio: {
      sobretitulo: "Planejamento financeiro",
      titulo: "Quando você pretende viver de renda?",
      texto: "Conte um pouco sobre seu momento financeiro e seus planos para o futuro.",
      tempo: "Leva cerca de 2 minutos",
    },

    perguntas: [
      {
        chave: "patrimonio",
        tipo: "escolha",
        pergunta: "Qual é o seu patrimônio atual?",
        apoio: "Considere uma estimativa do seu patrimônio total.",
        resumo: "Patrimônio",
        campo_crm: "patrimonio_faixa", // campo fixo no CRM: chaves combinadas com o CAIS V2
        opcoes: [
          { chave: "ate_100k", rotulo: "Até R$ 100 mil", icone: "moeda" },
          { chave: "acima_100k_ate_500k", rotulo: "Acima de R$ 100 mil até R$ 500 mil", icone: "moedas" },
          { chave: "acima_500k_ate_1m", rotulo: "Acima de R$ 500 mil até R$ 1 milhão", icone: "grafico" },
          { chave: "acima_1m_ate_10m", rotulo: "Acima de R$ 1 milhão até R$ 10 milhões", icone: "predio" },
          { chave: "acima_10m", rotulo: "Acima de R$ 10 milhões", icone: "diamante" },
        ],
      },
      {
        chave: "experiencia",
        tipo: "escolha",
        pergunta: "Há quanto tempo você investe regularmente?",
        apoio: "Considere o período em que realiza aportes com frequência.",
        resumo: "Histórico de investimentos",
        // Faixas provisórias: confirmar com Raul.
        opcoes: [
          { chave: "nao_investe", rotulo: "Ainda não invisto", icone: "broto" },
          { chave: "ate_3m", rotulo: "Até 3 meses", icone: "calendario" },
          { chave: "acima_3m_ate_12m", rotulo: "Acima de 3 meses até 12 meses", icone: "calendario_cheio" },
          { chave: "acima_12m", rotulo: "Acima de 12 meses", icone: "tendencia" },
        ],
      },
      {
        chave: "aporte",
        tipo: "escolha",
        pergunta: "Quanto da sua renda você consegue investir todos os meses?",
        apoio: "Selecione a faixa mais próxima da sua realidade.",
        resumo: "Capacidade de aporte",
        icones: "barras",
        opcoes: [
          { chave: "ate_10", rotulo: "Até 10%" },
          { chave: "acima_10_ate_20", rotulo: "Acima de 10% até 20%" },
          { chave: "acima_20_ate_30", rotulo: "Acima de 20% até 30%" },
          { chave: "acima_30", rotulo: "Acima de 30%" },
        ],
      },
      {
        chave: "idade_atual",
        tipo: "idade",
        pergunta: "Quantos anos você tem?",
        resumo: false, // a tela final mostra a idade pretendida e o horizonte
        placeholder: "Ex.: 30",
        minimo: 18, // pendente de confirmação; null = sem idade mínima
        maximo: 120,
        mensagens: {
          vazio: "Informe sua idade para continuar.",
          minimo: "Esta campanha é destinada a pessoas com {minimo} anos ou mais. Se você já tem {minimo} anos, confira o número digitado.",
          nota: "Esta campanha é destinada a pessoas com {minimo} anos ou mais.",
        },
      },
      {
        chave: "idade_objetivo",
        tipo: "idade",
        pergunta: "Com qual idade você pretende viver de renda?",
        resumo: "Idade pretendida",
        placeholder: "Ex.: 50",
        minimoDe: "idade_atual",
        maximo: 120,
        linhaDoTempo: { de: "idade_atual", titulo: "Seu horizonte de planejamento", resumo: "Horizonte de planejamento" },
        mensagens: {
          vazio: "Informe a idade em que você pretende viver de renda.",
          minimoDe: "A idade em que você pretende viver de renda não pode ser menor que sua idade atual ({referencia} anos). Informe {referencia} anos ou mais.",
        },
      },
      {
        chave: "renda",
        tipo: "moeda",
        pergunta: "Quanto você gostaria de receber por mês ao viver de renda?",
        resumo: "Renda mensal desejada",
        placeholder: "15.000,00",
        naoSei: "Ainda não sei",
        anual: { resumo: "Renda anual desejada" },
      },
    ],
  };
});
