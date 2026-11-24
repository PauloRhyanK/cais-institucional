/**
 * Configuração da página de captação "Planejamento".
 * Nenhuma credencial aqui: o navegador chama o Worker do próprio site (/planejamento/api),
 * que guarda o segredo do conector e entrega o lead ao CRM (Flow.ia). Nada é gravado no site.
 * As PERGUNTAS ficam em /planejamento/perguntas.js.
 * Contrato: docs/captacao-planejamento/contrato-recebimento.md
 */
window.CAIS_PLANEJAMENTO_CONFIG = {
  // Worker do site (mesmo domínio, sem CORS): /envios, /link/{codigo}, /eventos
  API_BASE: "/planejamento/api",

  // Privacidade — PENDENTE: URL da política e versão do aviso.
  POLITICA_PRIVACIDADE_URL: "",
  PRIVACIDADE_VERSAO: "",
  // true = exibe caixa de consentimento (desmarcada e obrigatória), se a base legal exigir.
  // O contrato atual não tem campo para registrar o consentimento: alinhar com o CRM antes de ativar.
  CONSENTIMENTO_EXPLICITO: false,

  // Telefone: só números do Brasil (pendente de confirmação).
  APENAS_BRASIL: true, // o servidor aceita só +55 enquanto a pendência não for resolvida

  // Link desativado: true = oferece seguir como acesso direto (sem atribuição).
  LINK_INATIVO_PERMITE_DIRETO: true,

  // Em localhost/rede interna o envio é simulado (npx serve não roda o Worker).
  // ?simular=falha simula indisponibilidade; ?api=real usa o Worker (wrangler dev).
  SIMULAR_EM_LOCALHOST: true,
};
