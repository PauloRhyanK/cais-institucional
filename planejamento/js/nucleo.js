/**
 * CAIS · Planejamento — núcleo sem DOM.
 * Validação, normalização, formatação e montagem do envio.
 * Roda no navegador (window.CaisPlanejamento) e no Node (module.exports),
 * para que o backend possa reaproveitar exatamente as mesmas regras.
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.CaisPlanejamento = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ------------------------------------------------------------------
  // Texto
  // ------------------------------------------------------------------
  function normalizarEspacos(valor) {
    return String(valor == null ? "" : valor)
      .replace(/[  -​  　]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  // ------------------------------------------------------------------
  // Nome
  // ------------------------------------------------------------------
  const NOME_MAX = 150;
  // Letras de qualquer alfabeto (com acentos combinados), espaço, hífen,
  // apóstrofos e ponto (abreviações como "Jr."). Precisa começar com letra.
  const NOME_PADRAO = /^[\p{L}][\p{L}\p{M}' ’.\-]*$/u;

  function validarNome(bruto) {
    const valor = normalizarEspacos(String(bruto == null ? "" : bruto).normalize("NFC"));
    if (!valor) return { ok: false, erro: "Informe seu nome para continuar." };
    if (!/^\p{L}/u.test(valor)) {
      return { ok: false, erro: "O nome precisa começar com uma letra. Ex.: Ana Souza." };
    }
    if (!NOME_PADRAO.test(valor)) {
      return { ok: false, erro: "O nome aceita só letras, espaços, hífens e apóstrofos. Remova números e símbolos." };
    }
    if (valor.length < 2) return { ok: false, erro: "Informe seu nome completo, com pelo menos duas letras." };
    if (valor.length > NOME_MAX) {
      return { ok: false, erro: `O nome pode ter até ${NOME_MAX} caracteres.` };
    }
    return { ok: true, valor };
  }

  // ------------------------------------------------------------------
  // E-mail (opcional)
  // ------------------------------------------------------------------
  const EMAIL_PADRAO = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

  function validarEmail(bruto) {
    const valor = String(bruto == null ? "" : bruto).trim();
    if (!valor) return { ok: true, valor: null };
    if (/\s/.test(valor)) return { ok: false, erro: "O e-mail não pode ter espaços. Ex.: nome@exemplo.com." };
    const arrobas = (valor.match(/@/g) || []).length;
    if (arrobas === 0) return { ok: false, erro: "Falta o @ no e-mail. Ex.: nome@exemplo.com." };
    if (arrobas > 1) return { ok: false, erro: "O e-mail tem mais de um @. Deixe apenas um. Ex.: nome@exemplo.com." };
    const dominio = valor.split("@")[1];
    if (!dominio || !dominio.includes(".") || /\.$/.test(dominio)) {
      return { ok: false, erro: "Falta o final do e-mail depois do @, como .com ou .com.br. Ex.: nome@exemplo.com." };
    }
    if (valor.length > 254 || !EMAIL_PADRAO.test(valor) || valor.includes("..")) {
      return { ok: false, erro: "Confira o e-mail: ele deve ter o formato nome@exemplo.com." };
    }
    return { ok: true, valor };
  }

  // ------------------------------------------------------------------
  // Idades
  // ------------------------------------------------------------------
  function lerInteiro(bruto) {
    const t = normalizarEspacos(bruto);
    if (!t) return { vazio: true };
    if (/^\d+[.,]\d*$/.test(t)) return { invalido: "decimal" };
    if (!/^\d+$/.test(t)) return { invalido: "caracteres" };
    return { valor: parseInt(t, 10) };
  }

  const ERRO_IDADE = {
    decimal: "Informe uma idade válida em anos completos, sem vírgula ou ponto. Ex.: 30.",
    caracteres: "Informe uma idade válida em anos completos, usando apenas números. Ex.: 30.",
    zero: "Informe uma idade válida em anos completos, maior que zero. Ex.: 30.",
  };

  function erroDeLeitura(lido) {
    if (lido.invalido) return ERRO_IDADE[lido.invalido];
    if (lido.valor === 0) return ERRO_IDADE.zero;
    return null;
  }

  /**
   * @param {object} regras { minima: number|null, maxima: number|null }
   */
  function validarIdade(bruto, regras) {
    const { minima = null, maxima = null } = regras || {};
    const lido = lerInteiro(bruto);
    if (lido.vazio) return { ok: false, erro: "Informe sua idade para continuar." };
    const erro = erroDeLeitura(lido);
    if (erro) return { ok: false, erro };
    if (minima != null && lido.valor < minima) {
      return {
        ok: false,
        erro: `Esta campanha é destinada a pessoas com ${minima} anos ou mais. Se você já tem ${minima} anos, confira o número digitado.`,
      };
    }
    if (maxima != null && lido.valor > maxima) {
      return { ok: false, erro: `Informe uma idade de até ${maxima} anos. Confira se não digitou um número a mais.` };
    }
    return { ok: true, valor: lido.valor };
  }

  function validarIdadeObjetivo(bruto, idadeAtual, regras) {
    const { maxima = null } = regras || {};
    const lido = lerInteiro(bruto);
    if (lido.vazio) {
      return { ok: false, erro: "Informe a idade em que você pretende viver de renda." };
    }
    const erro = erroDeLeitura(lido);
    if (erro) return { ok: false, erro };
    if (idadeAtual != null && lido.valor < idadeAtual) {
      return {
        ok: false,
        erro: `A idade em que você pretende viver de renda não pode ser menor que sua idade atual (${idadeAtual} anos). Informe ${idadeAtual} anos ou mais.`,
      };
    }
    if (maxima != null && lido.valor > maxima) {
      return { ok: false, erro: `Informe uma idade de até ${maxima} anos. Confira se não digitou um número a mais.` };
    }
    return { ok: true, valor: lido.valor };
  }

  function horizonteEmAnos(idadeAtual, idadeObjetivo) {
    if (!Number.isInteger(idadeAtual) || !Number.isInteger(idadeObjetivo)) return null;
    if (idadeObjetivo < idadeAtual) return null;
    return idadeObjetivo - idadeAtual;
  }

  // ------------------------------------------------------------------
  // Moeda (BRL, armazenada em centavos inteiros)
  // ------------------------------------------------------------------
  const MOEDA_MAX_CENTAVOS = 99999999999999; // R$ 999.999.999.999,99

  function agruparMilhar(inteiro) {
    return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function formatarCentavos(centavos) {
    const inteiro = Math.floor(centavos / 100).toString();
    const dec = String(centavos % 100).padStart(2, "0");
    return `${agruparMilhar(inteiro)},${dec}`;
  }

  function formatarMoeda(centavos) {
    return `R$ ${formatarCentavos(centavos)}`;
  }

  /**
   * Interpreta valores digitados ou colados: "15000", "15.000", "15.000,00",
   * "R$ 15.000,50", "15000,5", "15000.50" (decimal com ponto, comum em colagens).
   */
  function lerMoeda(bruto) {
    let s = String(bruto == null ? "" : bruto)
      .replace(/R\$/gi, "")
      .replace(/[\s ]/g, "");
    if (!s) return { vazio: true };
    if (/[^\d.,]/.test(s)) return { invalido: true };

    let inteiro;
    let dec = "";
    if (s.includes(",")) {
      const partes = s.split(",");
      if (partes.length !== 2) return { invalido: true };
      [inteiro, dec] = partes;
      if (inteiro.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return { invalido: true };
      inteiro = inteiro.replace(/\./g, "");
      if (!/^\d{0,2}$/.test(dec)) return { invalido: true };
    } else if (s.includes(".")) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) inteiro = s.replace(/\./g, "");
      else if (/^\d+\.\d{1,2}$/.test(s)) [inteiro, dec] = s.split(".");
      else return { invalido: true };
    } else {
      inteiro = s;
    }
    if (!/^\d*$/.test(inteiro) || (inteiro === "" && dec === "")) return { invalido: true };
    if (inteiro.replace(/^0+/, "").length > 12) return { grande: true };
    const centavos = parseInt(inteiro || "0", 10) * 100 + parseInt(dec.padEnd(2, "0") || "0", 10);
    return { valor: centavos };
  }

  function validarRenda(bruto, indefinida) {
    if (indefinida) return { ok: true, centavos: null, indefinida: true };
    const lido = lerMoeda(bruto);
    if (lido.vazio) {
      return { ok: false, erro: 'Informe um valor mensal ou selecione "Ainda não sei".' };
    }
    if (lido.invalido) {
      return {
        ok: false,
        erro: "Use apenas números, com ponto para milhar e vírgula para centavos. Ex.: 15.000,00.",
      };
    }
    if (lido.grande || lido.valor > MOEDA_MAX_CENTAVOS) {
      return { ok: false, erro: "O valor é maior que o aceito por este formulário. Confira se não digitou zeros a mais." };
    }
    if (lido.valor <= 0) {
      return {
        ok: false,
        erro: 'Informe um valor maior que zero. Se ainda não tem um valor em mente, selecione "Ainda não sei".',
      };
    }
    return { ok: true, centavos: lido.valor, indefinida: false };
  }

  /** Máscara durante a digitação: dígitos com milhar automático e vírgula decimal opcional. */
  function mascararMoedaDigitando(bruto, cursor) {
    const texto = String(bruto == null ? "" : bruto);
    const pos = cursor == null ? texto.length : cursor;
    const relevantesAntes = (texto.slice(0, pos).match(/[\d,]/g) || []).length;

    let limpo = texto.replace(/[^\d,]/g, "");
    const virgula = limpo.indexOf(",");
    let inteiro = virgula === -1 ? limpo : limpo.slice(0, virgula);
    let dec = virgula === -1 ? null : limpo.slice(virgula + 1).replace(/,/g, "");
    let removidos = 0;
    const semZeros = inteiro.replace(/^0+(?=\d)/, "");
    removidos += inteiro.length - semZeros.length;
    inteiro = semZeros;
    if (dec !== null && dec.length > 2) dec = dec.slice(0, 2);
    if (dec !== null && inteiro === "") inteiro = "0";

    const valor = agruparMilhar(inteiro) + (dec !== null ? "," + dec : "");
    return { valor, cursor: posicaoAposN(valor, Math.max(0, relevantesAntes - removidos), /[\d,]/) };
  }

  // ------------------------------------------------------------------
  // Telefone (WhatsApp)
  // ------------------------------------------------------------------
  function formatarNacional(d) {
    if (!d) return "";
    if (d.length <= 2) return `(${d}`;
    const ddd = d.slice(0, 2);
    const resto = d.slice(2);
    if (d.length <= 6) return `(${ddd}) ${resto}`;
    if (d.length <= 10) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
    const base = `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5, 9)}`;
    return d.length > 11 ? `${base} ${d.slice(11)}` : base;
  }

  /** Índice logo após o n-ésimo caractere que casa com `padrao`. */
  function posicaoAposN(texto, n, padrao) {
    if (n <= 0) {
      const primeiro = texto.search(padrao);
      return primeiro === -1 ? texto.length : Math.min(primeiro, texto.length);
    }
    let vistos = 0;
    for (let i = 0; i < texto.length; i++) {
      if (padrao.test(texto[i])) {
        vistos++;
        if (vistos === n) return i + 1;
      }
    }
    return texto.length;
  }

  /**
   * Máscara durante a digitação. Não inventa dígitos: só reorganiza os que
   * a pessoa informou. Com "+55" digitado, mantém o prefixo visível; um número
   * nacional com 55 colado na frente (12–13 dígitos) é lido como código do país.
   */
  function mascararTelefoneDigitando(bruto, cursor) {
    const texto = String(bruto == null ? "" : bruto);
    const pos = cursor == null ? texto.length : cursor;
    const digitosAntes = (texto.slice(0, pos).match(/\d/g) || []).length;
    const digitos = texto.replace(/\D/g, "");
    const comMais = /^\s*\+/.test(texto);

    let valor;
    let deslocamento = 0;
    if (comMais) {
      if (digitos === "" || digitos === "5") valor = "+" + digitos;
      else if (digitos.startsWith("55")) {
        const nacional = digitos.slice(2);
        valor = "+55" + (nacional ? " " + formatarNacional(nacional) : "");
      } else valor = "+" + digitos;
    } else if (digitos.length > 11 && digitos.startsWith("55")) {
      valor = formatarNacional(digitos.slice(2));
      deslocamento = 2;
    } else {
      valor = formatarNacional(digitos);
    }
    const n = Math.max(0, digitosAntes - deslocamento);
    return { valor, cursor: n === 0 && !comMais ? 0 : posicaoAposN(valor, n, /\d/) };
  }

  /**
   * Normalização definitiva com libphonenumber-js.
   * @param {object} lib objeto libphonenumber (bundle min)
   */
  function normalizarTelefone(bruto, lib, opcoes) {
    const { apenasBrasil = true } = opcoes || {};
    const texto = normalizarEspacos(bruto);
    if (!texto) return { ok: false, erro: "Informe seu WhatsApp para continuar." };
    if (/[^\d\s()+.\-]/.test(texto)) {
      return { ok: false, erro: "Use apenas números no telefone, com DDD. Ex.: (27) 99999-8888." };
    }
    const digitos = texto.replace(/\D/g, "");
    const comMais = texto.startsWith("+");
    let numero;
    try {
      numero = comMais
        ? lib.parsePhoneNumberFromString("+" + digitos)
        : lib.parsePhoneNumberFromString(digitos, "BR");
    } catch (_) {
      numero = undefined;
    }
    if (numero && numero.country && numero.country !== "BR" && numero.isValid()) {
      if (apenasBrasil) {
        return { ok: false, erro: "No momento atendemos apenas números do Brasil (+55). Informe um número com DDD brasileiro." };
      }
      return { ok: true, e164: numero.number, exibicao: numero.formatInternational(), pais: numero.country };
    }
    if (!numero || !numero.isValid()) {
      const nacional = comMais && digitos.startsWith("55") ? digitos.slice(2) : !comMais && digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
      if (!comMais || digitos.startsWith("55")) {
        if (nacional.length < 10) {
          const esperado = nacional.length >= 3 && nacional[2] === "9" ? 11 : 10;
          const faltam = esperado - nacional.length;
          if (nacional.length <= 2) {
            return { ok: false, erro: "Informe o DDD e o número completo. Ex.: (27) 99999-8888." };
          }
          return {
            ok: false,
            erro: `O número está incompleto: ${faltam === 1 ? "falta 1 dígito" : `faltam ${faltam} dígitos`}. Informe DDD + número. Ex.: (27) 99999-8888.`,
          };
        }
        if (nacional.length > 11) {
          return { ok: false, erro: "O número tem dígitos a mais. Informe só DDD + número. Ex.: (27) 99999-8888." };
        }
      }
      return { ok: false, erro: "Confira o número: ele não parece um telefone válido do Brasil. Verifique o DDD." };
    }
    return {
      ok: true,
      e164: numero.number,
      exibicao: formatarNacional(String(numero.nationalNumber)),
      pais: "BR",
    };
  }

  // ------------------------------------------------------------------
  // Atribuição e contexto (sem dados pessoais)
  // ------------------------------------------------------------------
  const UTM_CHAVES = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];

  function lerUtms(busca) {
    const params = new URLSearchParams(busca || "");
    const utm = {};
    for (const chave of UTM_CHAVES) {
      const v = normalizarEspacos(params.get(chave) || "").slice(0, 500);
      if (v) utm[chave] = v;
    }
    return utm;
  }

  const CODIGO_PADRAO = /^[a-z0-9]{4,16}$/; // contrato: ^[a-z0-9]{4,16}$

  function lerCodigoDoCaminho(caminho) {
    const m = /\/planejamento\/r\/([^/?#]+)\/?$/i.exec(caminho || "");
    if (!m) return null;
    const codigo = decodeURIComponent(m[1]).toLowerCase();
    return CODIGO_PADRAO.test(codigo) ? codigo : { invalido: true };
  }

  function dominioDeReferencia(referrer, hostAtual) {
    try {
      const h = new URL(referrer).hostname;
      return h && h !== hostAtual ? h : null;
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Perguntas configuráveis (planejamento/perguntas.js)
  // Valores normalizados por tipo:
  //   escolha → chave da opção · idade/inteiro → número · texto → string
  //   moeda   → centavos (inteiro > 0) ou NAO_SEI
  // ------------------------------------------------------------------
  const NAO_SEI = "nao_sei";
  const TIPOS = ["escolha", "idade", "inteiro", "moeda", "texto"];
  const CHAVES_RESERVADAS = ["inicio", "identificacao", "sucesso", "indisponivel", "nome", "telefone", "email", "consentimento", "site"];

  function preencher(modelo, dados) {
    return String(modelo).replace(/\{(\w+)\}/g, (_, k) => (dados[k] == null ? "" : String(dados[k])));
  }

  function mensagem(p, nome, padrao, dados) {
    const m = (p.mensagens && p.mensagens[nome]) || padrao;
    return preencher(m, { minimo: p.minimo, maximo: p.maximo, ...(dados || {}) });
  }

  const ERRO_INTEIRO = {
    decimal: "Informe um número inteiro, sem vírgula ou ponto.",
    caracteres: "Informe um número inteiro, usando apenas números.",
  };

  /**
   * Valida a resposta de uma pergunta.
   * @param p        definição da pergunta
   * @param bruto    texto digitado, chave escolhida ou valor já normalizado
   * @param respostas respostas normalizadas já conhecidas (para `minimoDe`)
   * @returns {{ok:true, valor:any, vazia?:true} | {ok:false, erro:string}}
   */
  function validarResposta(p, bruto, respostas) {
    const vazio = bruto === undefined || bruto === null || (typeof bruto === "string" && !normalizarEspacos(bruto));
    if (vazio) {
      if (p.opcional) return { ok: true, valor: null, vazia: true };
      const padrao = p.tipo === "escolha" ? "Selecione uma opção para continuar." : "Responda para continuar.";
      return { ok: false, erro: mensagem(p, "vazio", padrao) };
    }

    if (p.tipo === "escolha") {
      const opcao = (p.opcoes || []).find((o) => o.chave === bruto);
      return opcao ? { ok: true, valor: opcao.chave } : { ok: false, erro: mensagem(p, "vazio", "Selecione uma opção para continuar.") };
    }

    if (p.tipo === "idade" || p.tipo === "inteiro") {
      const idade = p.tipo === "idade";
      const lido = typeof bruto === "number" ? (Number.isInteger(bruto) && bruto >= 0 ? { valor: bruto } : { invalido: "caracteres" }) : lerInteiro(bruto);
      if (lido.invalido) return { ok: false, erro: (idade ? ERRO_IDADE : ERRO_INTEIRO)[lido.invalido] };
      if (idade && lido.valor === 0) return { ok: false, erro: ERRO_IDADE.zero };
      const v = lido.valor;
      if (p.minimo != null && v < p.minimo) {
        return { ok: false, erro: mensagem(p, "minimo", idade ? "Informe uma idade de {minimo} anos ou mais." : "Informe um número a partir de {minimo}.") };
      }
      if (p.maximo != null && v > p.maximo) {
        return {
          ok: false,
          erro: mensagem(p, "maximo", idade ? "Informe uma idade de até {maximo} anos. Confira se não digitou um número a mais." : "Informe um número de até {maximo}."),
        };
      }
      const referencia = p.minimoDe && respostas ? respostas[p.minimoDe] : null;
      if (Number.isInteger(referencia) && v < referencia) {
        return { ok: false, erro: mensagem(p, "minimoDe", "Informe um valor igual ou maior que {referencia}.", { referencia }) };
      }
      return { ok: true, valor: v };
    }

    if (p.tipo === "moeda") {
      if (bruto === NAO_SEI) {
        return p.naoSei ? { ok: true, valor: NAO_SEI } : { ok: false, erro: "Informe um valor em reais." };
      }
      if (typeof bruto === "number") {
        return Number.isInteger(bruto) && bruto > 0 && bruto <= MOEDA_MAX_CENTAVOS
          ? { ok: true, valor: bruto }
          : { ok: false, erro: "Informe um valor maior que zero." };
      }
      const r = validarRenda(bruto, false);
      if (r.ok) return { ok: true, valor: r.centavos };
      let erro = r.erro;
      if (!p.naoSei) erro = erro.replace(/ ?(Se ainda não tem um valor em mente, )?selecione "Ainda não sei"\.?/, "").replace(/ ou $/, ".");
      else if (p.naoSei !== "Ainda não sei") erro = erro.replace("Ainda não sei", p.naoSei);
      return { ok: false, erro: mensagem(p, "invalido", erro) };
    }

    if (p.tipo === "texto") {
      const v = normalizarEspacos(bruto);
      const max = p.maximo || 500;
      if (v.length > max) return { ok: false, erro: mensagem(p, "maximo", `Use até ${max} caracteres.`) };
      return { ok: true, valor: v };
    }

    return { ok: false, erro: "Tipo de pergunta desconhecido." };
  }

  function plural(n, singular, pluralTexto) {
    return `${n} ${n === 1 ? singular : pluralTexto}`;
  }

  /** Texto legível de uma resposta normalizada. */
  function rotuloResposta(p, valor) {
    if (valor == null) return null;
    if (p.tipo === "escolha") {
      const o = (p.opcoes || []).find((x) => x.chave === valor);
      return o ? o.rotulo : null;
    }
    if (p.tipo === "idade") return plural(valor, "ano", "anos");
    if (p.tipo === "inteiro") return p.sufixo ? `${valor} ${p.sufixo}` : String(valor);
    if (p.tipo === "moeda") return valor === NAO_SEI ? p.naoSei : formatarMoeda(valor);
    return String(valor);
  }

  /**
   * Pares legíveis (pergunta/resposta) para o CRM e o resumo, na ordem do formulário,
   * com os derivados: horizonte da linha do tempo e valor anual da moeda.
   * `destino`: "crm" (todas) ou "resumo" (usa os rótulos curtos `resumo`).
   */
  function respostasLegiveis(formulario, respostas, destino) {
    const saida = [];
    const resumo = destino === "resumo";
    for (const p of formulario.perguntas) {
      const valor = respostas[p.chave];
      if (valor == null) continue;
      if (resumo && (p.resumo === false || valor === NAO_SEI)) continue;
      saida.push({ chave: p.chave, pergunta: resumo ? p.resumo || p.pergunta : p.pergunta, resposta: rotuloResposta(p, valor) });
      if (p.linhaDoTempo && !(resumo && p.linhaDoTempo.resumo === false)) {
        const anos = horizonteEmAnos(respostas[p.linhaDoTempo.de], valor);
        if (anos != null) {
          const rotulo = p.linhaDoTempo.resumo || "Horizonte";
          saida.push({ chave: `${p.chave}_horizonte`, pergunta: rotulo, resposta: plural(anos, "ano", "anos") });
        }
      }
      if (p.tipo === "moeda" && p.anual && valor !== NAO_SEI && !resumo) {
        saida.push({ chave: `${p.chave}_anual`, pergunta: p.anual.resumo || "Valor anual", resposta: formatarMoeda(valor * 12) });
      }
    }
    return saida;
  }

  /** Erro de configuração em perguntas.js (testado para não publicar formulário quebrado). */
  function verificarFormulario(formulario) {
    const problemas = [];
    const chaves = new Set();
    if (!formulario || !Array.isArray(formulario.perguntas) || !formulario.perguntas.length) return ["sem perguntas"];
    if (!/^[a-z0-9][a-z0-9._-]{0,49}$/i.test(formulario.versao || "")) problemas.push("versao inválida");
    if (formulario.perguntas.length > 25) problemas.push("mais de 25 perguntas (o CRM aceita até 30 respostas, contando derivados)");
    formulario.perguntas.forEach((p, i) => {
      const onde = `perguntas[${i}] (${p.chave || "?"})`;
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(p.chave || "")) problemas.push(`${onde}: chave inválida`);
      if (chaves.has(p.chave)) problemas.push(`${onde}: chave repetida`);
      if (CHAVES_RESERVADAS.includes(p.chave)) problemas.push(`${onde}: chave reservada`);
      chaves.add(p.chave);
      if (!TIPOS.includes(p.tipo)) problemas.push(`${onde}: tipo desconhecido`);
      if (!p.pergunta || p.pergunta.length > 300) problemas.push(`${onde}: pergunta vazia ou longa demais`);
      if (p.tipo === "escolha") {
        const opcoes = p.opcoes || [];
        if (opcoes.length < 2) problemas.push(`${onde}: escolha precisa de ao menos 2 opções`);
        const vistas = new Set();
        for (const o of opcoes) {
          if (!/^[a-z0-9_]{1,60}$/.test(o.chave || "")) problemas.push(`${onde}: opção com chave inválida`);
          if (vistas.has(o.chave)) problemas.push(`${onde}: opção repetida ${o.chave}`);
          vistas.add(o.chave);
          if (!o.rotulo) problemas.push(`${onde}: opção sem rótulo`);
        }
      }
      for (const ref of [p.minimoDe, p.linhaDoTempo && p.linhaDoTempo.de].filter(Boolean)) {
        const idx = formulario.perguntas.findIndex((q) => q.chave === ref);
        if (idx === -1 || idx >= i) problemas.push(`${onde}: referência a "${ref}" precisa ser uma pergunta anterior`);
      }
    });
    return problemas;
  }

  // ------------------------------------------------------------------
  // Envio navegador → Worker do site (POST /planejamento/api/envios).
  // O navegador manda só os valores normalizados por chave; o Worker valida de novo
  // com o mesmo perguntas.js e monta o lead do CRM (worker/index.js › montarLead).
  // ------------------------------------------------------------------
  function montarEnvio(dados, ctx) {
    const corpo = { id: ctx.id };
    if (ctx.linkCodigo) corpo.link = ctx.linkCodigo;
    corpo.pessoa = { nome: dados.nome, telefone: dados.telefone_e164 };
    if (dados.email) corpo.pessoa.email = dados.email;

    const respostas = {};
    for (const [chave, valor] of Object.entries(dados.respostas || {})) if (valor != null) respostas[chave] = valor;
    corpo.respostas = respostas;

    const utm = {};
    for (const chave of UTM_CHAVES) if (ctx.utm && ctx.utm[chave]) utm[chave] = ctx.utm[chave];
    if (Object.keys(utm).length) corpo.utm = utm;

    const envio = { form_versao: ctx.versaoFormulario };
    if (ctx.privacidadeVersao) envio.privacidade_versao = ctx.privacidadeVersao;
    if (ctx.duracaoSegundos != null) envio.duracao_segundos = ctx.duracaoSegundos;
    if (ctx.dispositivo) envio.dispositivo = ctx.dispositivo;
    envio.sessao_id = ctx.sessaoId;
    if (ctx.referenciaDominio) envio.referencia_dominio = ctx.referenciaDominio;
    corpo.envio = envio;

    corpo.site = ctx.armadilha || "";
    return corpo;
  }

  /** Caminho devolvido no 400 (ex.: "pessoa.telefone", "respostas.renda") → tela e campo. */
  function campoDoCaminho(caminho) {
    const pessoa = /^pessoa\.(nome|telefone|email)$/.exec(caminho || "");
    if (pessoa) return ["identificacao", pessoa[1]];
    const resposta = /^respostas\.([a-z][a-z0-9_]*)$/.exec(caminho || "");
    if (resposta) return [resposta[1], resposta[1]];
    return null;
  }

  return {
    NAO_SEI,
    normalizarEspacos,
    validarNome,
    validarEmail,
    validarIdade,
    validarIdadeObjetivo,
    horizonteEmAnos,
    lerMoeda,
    validarRenda,
    formatarMoeda,
    formatarCentavos,
    mascararMoedaDigitando,
    formatarNacional,
    mascararTelefoneDigitando,
    normalizarTelefone,
    lerUtms,
    lerCodigoDoCaminho,
    dominioDeReferencia,
    validarResposta,
    rotuloResposta,
    respostasLegiveis,
    verificarFormulario,
    montarEnvio,
    campoDoCaminho,
    UTM_CHAVES,
  };
});
