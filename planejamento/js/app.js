/**
 * CAIS · Planejamento — fluxo conversacional (uma pergunta por vez).
 * As perguntas vêm de /planejamento/perguntas.js; esta camada só desenha e conduz.
 * Respostas ficam só em memória; nada pessoal ou financeiro é gravado no navegador.
 */
(function () {
  "use strict";

  const N = window.CaisPlanejamento;
  const S = window.CaisPlanejamentoServicos;
  const F = window.CAIS_PLANEJAMENTO_FORMULARIO;
  const cfg = window.CAIS_PLANEJAMENTO_CONFIG || {};
  const lib = window.libphonenumber;
  const reduzirMovimento = matchMedia("(prefers-reduced-motion: reduce)");

  const problemas = N.verificarFormulario(F);
  if (problemas.length) console.error("[planejamento] perguntas.js com problemas:", problemas);

  const PERGUNTAS = F.perguntas;
  const PERGUNTA = Object.fromEntries(PERGUNTAS.map((p) => [p.chave, p]));
  const ORDEM = ["inicio", ...PERGUNTAS.map((p) => p.chave), "identificacao", "sucesso"];
  const TOTAL_ETAPAS = PERGUNTAS.length + 1;
  const IDENTIFICACAO = ["nome", "telefone", "email", "consentimento"];

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
  const esc = (t) =>
    String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const plural = (n) => `${n} ${n === 1 ? "ano" : "anos"}`;

  /** Respostas normalizadas por chave (escolha → chave, idade → número, moeda → centavos | N.NAO_SEI). */
  const respostas = {};
  const escolhas = {}; // seleção atual dos cartões
  const naoSei = {}; // moeda com "Ainda não sei" marcado
  const dados = { nome: null, telefone_e164: null, email: null };

  const ui = {
    telaAtual: null,
    inicioEm: null,
    enviando: false,
    concluido: false,
    envio: null, // { chave, json } — corpo congelado do envio atual
    etapasRegistradas: new Set(),
  };

  // ------------------------------------------------------------------
  // Ícones discretos das alternativas (nome → desenho)
  // ------------------------------------------------------------------
  const ICONES = {
    moeda: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/>',
    moedas:
      '<ellipse cx="12" cy="9" rx="6.5" ry="2.5"/><path d="M5.5 9v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V9"/><path d="M5.5 12v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-3"/>',
    grafico: '<path d="M4 20h16"/><path d="M6 20v-6M10 20V10M14 20V12M18 20V6"/>',
    predio: '<path d="M4 20h16"/><path d="M6 20V9l6-4 6 4v11"/><path d="M10 20v-5h4v5"/>',
    diamante: '<path d="M12 3l7 9-7 9-7-9z"/><path d="M5 12h14M12 3v18"/>',
    broto: '<path d="M12 20v-7"/><path d="M12 13c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6z"/><path d="M12 15c0-3 2-5.5 6-5.5 0 3-2 5.5-6 5.5z"/>',
    calendario: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/><circle cx="9" cy="14.5" r="1"/>',
    calendario_cheio:
      '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M8 14.5h1M11.5 14.5h1M15 14.5h1M8 17.5h1M11.5 17.5h1"/>',
    tendencia: '<path d="M4 18l5-5 3.5 3.5L20 9"/><path d="M15 9h5v5"/>',
    alvo: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8"/>',
    casa: '<path d="M4 11l8-6 8 6"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    escudo: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
    relogio: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.6" cy="7.4" r="0.6"/>',
    pessoa: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>',
    pessoas: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5"/><circle cx="16.5" cy="8" r="2.5"/><path d="M16 13.5c2.6 0 4.5 2 4.5 4.8"/>',
  };

  function iconeDaOpcao(p, opcao, indice) {
    if (p.icones === "barras") {
      const total = p.opcoes.length;
      const largura = 20 / total;
      const barras = p.opcoes
        .map((_, i) => {
          const a = 6 + Math.round((12 * i) / Math.max(1, total - 1));
          return `<rect class="${i <= indice ? "cheia" : "vazia"}" x="${2 + i * largura}" y="${21 - a}" width="${largura * 0.65}" height="${a}" rx="1"/>`;
        })
        .join("");
      return `<svg class="cartao-icone barras" viewBox="0 0 24 24" aria-hidden="true">${barras}</svg>`;
    }
    const desenho = opcao.icone && ICONES[opcao.icone];
    return desenho ? `<svg class="cartao-icone" viewBox="0 0 24 24" aria-hidden="true">${desenho}</svg>` : "";
  }

  // ------------------------------------------------------------------
  // Montagem das telas a partir de perguntas.js
  // ------------------------------------------------------------------
  function htmlDaPergunta(p) {
    const k = p.chave;
    const apoio = p.apoio ? `<p class="apoio" id="a-${k}">${esc(p.apoio)}</p>` : "";
    const opcional = p.opcional ? `<p class="nota">Opcional: você pode continuar sem responder.</p>` : "";
    const descricao = [p.apoio ? `a-${k}` : "", `erro-${k}`].filter(Boolean).join(" ");
    let corpo;

    if (p.tipo === "escolha") {
      const cartoes = p.opcoes
        .map(
          (o, i) => `<label class="cartao">
            <input type="radio" name="${k}" value="${esc(o.chave)}" />
            ${iconeDaOpcao(p, o, i)}
            <span class="cartao-texto">${esc(o.rotulo)}</span>
            <span class="cartao-marca" aria-hidden="true"></span>
          </label>`
        )
        .join("");
      corpo = `<fieldset class="grupo" aria-describedby="${descricao}">
          <legend class="titulo" id="t-${k}" tabindex="-1">${esc(p.pergunta)}</legend>
          ${apoio}
          <div class="cartoes" data-grupo="${k}" role="radiogroup" aria-labelledby="t-${k}">${cartoes}</div>
        </fieldset>
        <p class="erro" id="erro-${k}" role="alert"></p>`;
    } else if (p.tipo === "idade" || p.tipo === "inteiro") {
      const sufixo = p.tipo === "idade" ? "anos" : p.sufixo || "";
      const temNota = p.mensagens && p.mensagens.nota && p.minimo != null;
      const nota = temNota ? `<p class="nota" id="nota-${k}">${esc(p.mensagens.nota.replace(/\{minimo\}/g, p.minimo))}</p>` : "";
      const linha = p.linhaDoTempo ? `<div class="linha-tempo" id="lt-${k}" aria-live="polite" hidden></div>` : "";
      corpo = `<h2 class="titulo" id="t-${k}" tabindex="-1">${esc(p.pergunta)}</h2>
        ${apoio}
        <div class="campo-numero">
          <input id="campo-${k}" class="entrada-grande" type="text" inputmode="numeric" pattern="[0-9]*"
            autocomplete="off" enterkeyhint="next" placeholder="${esc(p.placeholder || "")}"
            aria-labelledby="t-${k}" aria-describedby="${descricao}${temNota ? ` nota-${k}` : ""}${linha ? ` lt-${k}` : ""}" />
          ${sufixo ? `<span class="sufixo" aria-hidden="true">${esc(sufixo)}</span>` : ""}
        </div>
        <p class="erro" id="erro-${k}" role="alert"></p>
        ${nota}${linha}`;
    } else if (p.tipo === "moeda") {
      const botaoNaoSei = p.naoSei
        ? `<button type="button" class="alternar" id="naosei-${k}" aria-pressed="false">
             <span class="alternar-marca" aria-hidden="true"></span>${esc(p.naoSei)}
           </button>`
        : "";
      corpo = `<h2 class="titulo" id="t-${k}" tabindex="-1">${esc(p.pergunta)}</h2>
        ${apoio}
        <div class="campo-moeda" id="caixa-${k}">
          <span class="prefixo" aria-hidden="true">R$</span>
          <input id="campo-${k}" class="entrada-grande" type="text" inputmode="decimal" autocomplete="off"
            enterkeyhint="next" placeholder="${esc(p.placeholder || "")}" aria-labelledby="t-${k}" aria-describedby="${descricao}" />
        </div>
        <p class="erro" id="erro-${k}" role="alert"></p>
        ${botaoNaoSei}`;
    } else {
      corpo = `<h2 class="titulo" id="t-${k}" tabindex="-1">${esc(p.pergunta)}</h2>
        ${apoio}
        <div class="campo">
          <input id="campo-${k}" class="entrada" type="text" autocomplete="off" maxlength="${p.maximo || 500}"
            placeholder="${esc(p.placeholder || "")}" aria-labelledby="t-${k}" aria-describedby="${descricao}" />
        </div>
        <p class="erro" id="erro-${k}" role="alert"></p>`;
    }

    return `<section class="tela" data-tela="${k}" aria-labelledby="t-${k}" hidden>
      <form class="formulario" novalidate>
        ${corpo}
        ${opcional}
        <button type="submit" class="botao">Continuar</button>
      </form>
    </section>`;
  }

  function montarTelas() {
    const i = F.inicio || {};
    if (i.sobretitulo) $("#inicio-sobretitulo").textContent = i.sobretitulo;
    if (i.titulo) {
      $("#t-inicio").textContent = i.titulo;
      document.title = `${i.titulo} — Cais Investimentos`;
    }
    if (i.texto) $("#inicio-texto").textContent = i.texto;
    $("#inicio-tempo").textContent = `${i.tempo || "Leva poucos minutos"} · ${TOTAL_ETAPAS} perguntas`;
    $('section[data-tela="identificacao"]').insertAdjacentHTML("beforebegin", PERGUNTAS.map(htmlDaPergunta).join(""));
  }

  // ------------------------------------------------------------------
  // Erros por campo
  // ------------------------------------------------------------------
  function alvoDoErro(campo) {
    if (IDENTIFICACAO.includes(campo)) return $("#" + campo);
    const p = PERGUNTA[campo];
    return p && p.tipo === "escolha" ? $(`[data-grupo="${campo}"]`) : $("#campo-" + campo);
  }

  function mostrarErro(campo, mensagem) {
    $("#erro-" + campo).textContent = mensagem;
    alvoDoErro(campo)?.setAttribute("aria-invalid", "true");
  }

  function limparErro(campo) {
    $("#erro-" + campo).textContent = "";
    alvoDoErro(campo)?.removeAttribute("aria-invalid");
  }

  const temErro = (campo) => !!$("#erro-" + campo).textContent;

  function aplicar(campo, resultado, mostrar) {
    if (resultado.ok) limparErro(campo);
    else if (mostrar) mostrarErro(campo, resultado.erro);
    return resultado.ok;
  }

  // ------------------------------------------------------------------
  // Validação
  // ------------------------------------------------------------------
  function brutoDa(p) {
    if (p.tipo === "escolha") return escolhas[p.chave];
    if (p.tipo === "moeda" && naoSei[p.chave]) return N.NAO_SEI;
    return $("#campo-" + p.chave).value;
  }

  function validarPergunta(p, mostrar) {
    const r = N.validarResposta(p, brutoDa(p), respostas);
    if (r.ok && r.valor != null) respostas[p.chave] = r.valor;
    else delete respostas[p.chave];
    return aplicar(p.chave, r, mostrar);
  }

  function validarIdentificacao(mostrar) {
    const nome = N.validarNome($("#nome").value);
    dados.nome = nome.ok ? nome.valor : null;
    const tel = N.normalizarTelefone($("#telefone").value, lib, { apenasBrasil: cfg.APENAS_BRASIL !== false });
    dados.telefone_e164 = tel.ok ? tel.e164 : null;
    const email = N.validarEmail($("#email").value, true);
    dados.email = email.ok ? email.valor : null;
    let consentimento = { ok: true };
    if (cfg.CONSENTIMENTO_EXPLICITO && !$("#consentimento").checked) {
      consentimento = { ok: false, erro: "Para continuar, confirme que concorda com o tratamento dos seus dados." };
    }
    return [
      aplicar("nome", nome, mostrar),
      aplicar("telefone", tel, mostrar),
      aplicar("email", email, mostrar),
      aplicar("consentimento", consentimento, mostrar),
    ].every(Boolean);
  }

  function validarTela(tela, mostrar) {
    if (tela === "identificacao") return validarIdentificacao(mostrar);
    const p = PERGUNTA[tela];
    return p ? validarPergunta(p, mostrar) : true;
  }

  // ------------------------------------------------------------------
  // Navegação
  // ------------------------------------------------------------------
  function irPara(tela, { direcao = "frente", historico = true } = {}) {
    const proxima = $(`section[data-tela="${tela}"]`);
    if (!proxima || ui.telaAtual === tela) return;
    for (const s of $$(".tela")) {
      if (s !== proxima) {
        s.hidden = true;
        s.classList.remove("entra-frente", "entra-tras");
      }
    }
    proxima.hidden = false;
    proxima.classList.remove("entra-frente", "entra-tras");
    void proxima.offsetWidth; // reinicia a animação
    proxima.classList.add(direcao === "tras" ? "entra-tras" : "entra-frente");
    ui.telaAtual = tela;

    const indice = ORDEM.indexOf(tela);
    atualizarTopo(tela, indice);
    if (historico) history.pushState({ tela }, "", location.pathname + location.search);

    if (PERGUNTA[tela]) aoEntrar(PERGUNTA[tela]);
    focarTela(proxima, tela);

    if (indice >= 1 && indice <= TOTAL_ETAPAS && !ui.etapasRegistradas.has(indice)) {
      ui.etapasRegistradas.add(indice);
      S.registrarEvento("etapa", indice);
    }
  }

  function focarTela(secao, tela) {
    // Foco síncrono: quem digita rápido logo após "Enter" não perde caracteres.
    const p = PERGUNTA[tela];
    const campo = p && p.tipo !== "escolha" && !(p.tipo === "moeda" && naoSei[p.chave]) ? $("#campo-" + p.chave) : null;
    const escolhido = $("input[type=radio]:checked", secao);
    if (campo) campo.focus({ preventScroll: true });
    else if (escolhido) escolhido.focus({ preventScroll: true });
    else $(".titulo", secao)?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function atualizarTopo(tela, indice) {
    const emEtapa = indice >= 1 && indice <= TOTAL_ETAPAS;
    $("#voltar").hidden = !emEtapa;
    $("#progresso").hidden = !emEtapa && tela !== "sucesso";
    const feito = tela === "sucesso" ? TOTAL_ETAPAS : Math.max(0, indice - 1);
    $("#progresso-barra").style.width = `${(feito / TOTAL_ETAPAS) * 100}%`;
    $("#progresso").setAttribute("aria-valuemax", String(TOTAL_ETAPAS));
    $("#progresso").setAttribute("aria-valuenow", String(feito));
    $("#progresso").setAttribute("aria-valuetext", emEtapa ? `Etapa ${indice} de ${TOTAL_ETAPAS}` : "Concluído");
    $("#etapa-atual").textContent = emEtapa ? `Etapa ${indice} de ${TOTAL_ETAPAS}` : "";
    document.body.dataset.telaAtual = tela;
  }

  function avancar() {
    const tela = ui.telaAtual;
    if (!validarTela(tela, true)) {
      const campo = tela === "identificacao" ? IDENTIFICACAO.find(temErro) || "nome" : tela;
      const alvo = alvoDoErro(campo);
      if (alvo && alvo.tagName === "INPUT") alvo.focus();
      return;
    }
    if (tela === "identificacao") return concluir();
    irPara(ORDEM[ORDEM.indexOf(tela) + 1]);
  }

  window.addEventListener("popstate", (e) => {
    const destino = e.state && e.state.tela;
    if (ui.concluido || ui.enviando) {
      history.pushState({ tela: ui.telaAtual }, "", location.pathname + location.search);
      return;
    }
    if (!destino || !ORDEM.includes(destino)) {
      irPara("inicio", { direcao: "tras", historico: false });
      return;
    }
    const alvo = ORDEM.indexOf(destino);
    const atual = ORDEM.indexOf(ui.telaAtual);
    // Avançar pelo histórico só até onde as respostas anteriores continuam válidas.
    if (alvo > atual) {
      for (let i = 1; i < alvo; i++) {
        if (!validarTela(ORDEM[i], false)) {
          irPara(ORDEM[i], { historico: false });
          history.replaceState({ tela: ORDEM[i] }, "", location.pathname + location.search);
          return;
        }
      }
    }
    irPara(destino, { direcao: alvo < atual ? "tras" : "frente", historico: false });
  });

  // ------------------------------------------------------------------
  // Comportamento dos campos
  // ------------------------------------------------------------------
  function ligarCartoes(p) {
    const grupo = $(`[data-grupo="${p.chave}"]`);
    let ultimoToque = 0;
    const avancarDepois = (ms) => {
      const tela = ui.telaAtual;
      setTimeout(() => ui.telaAtual === tela && avancar(), ms);
    };
    grupo.addEventListener("pointerdown", () => (ultimoToque = Date.now()));
    grupo.addEventListener("change", (e) => {
      escolhas[p.chave] = e.target.value;
      validarPergunta(p, false);
      limparErro(p.chave);
      // Toque/clique avança sozinho; setas do teclado só mudam a seleção.
      if (Date.now() - ultimoToque < 1200) avancarDepois(reduzirMovimento.matches ? 120 : 380);
    });
    // Tocar de novo numa opção já escolhida (ao voltar) também avança.
    grupo.addEventListener("click", (e) => {
      const input = e.target.closest(".cartao")?.querySelector("input");
      if (!input || e.detail === 0) return;
      if (input.checked && escolhas[p.chave] === input.value && Date.now() - ultimoToque < 1200) avancarDepois(200);
    });
  }

  function ligarMascara(input, mascarar, relevante, aoColar) {
    function aplicarMascara(cursor) {
      const r = mascarar(input.value, cursor);
      if (r.valor !== input.value) {
        input.value = r.valor;
        if (document.activeElement === input) input.setSelectionRange(r.cursor, r.cursor);
      }
    }
    // Apagar sobre um separador apaga o caractere relevante vizinho (não "trava").
    input.addEventListener("beforeinput", (e) => {
      const ini = input.selectionStart;
      if (ini !== input.selectionEnd) return;
      const v = input.value;
      if (e.inputType === "deleteContentBackward" && ini > 0 && !relevante.test(v[ini - 1])) {
        let j = ini - 1;
        while (j >= 0 && !relevante.test(v[j])) j--;
        if (j < 0) return;
        e.preventDefault();
        input.value = v.slice(0, j) + v.slice(j + 1);
        aplicarMascara(j);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (e.inputType === "deleteContentForward" && ini < v.length && !relevante.test(v[ini])) {
        let j = ini;
        while (j < v.length && !relevante.test(v[j])) j++;
        if (j >= v.length) return;
        e.preventDefault();
        input.value = v.slice(0, j) + v.slice(j + 1);
        aplicarMascara(ini);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    input.addEventListener("input", (e) => {
      // Colagem e preenchimento automático chegam inteiros: normaliza de uma vez.
      const emBloco = !e.inputType || ["insertFromPaste", "insertReplacementText", "insertFromDrop"].includes(e.inputType);
      if (emBloco && aoColar(input)) return;
      aplicarMascara(input.selectionStart);
    });
  }

  /**
   * Orientação durante a digitação: caractere claramente inválido explica na hora;
   * o resto só depois de uma pausa (quem digita "1" a caminho de "18" não vê erro).
   * Com erro já visível, revalida a cada tecla para a mensagem sumir assim que corrigir.
   */
  const ORIENTACAO = {
    idade: { pausa: 900, invalido: /[^\d\s]/ },
    inteiro: { pausa: 900, invalido: /[^\d\s]/ },
    moeda: { pausa: 1000, invalido: /[^\d.,\s]/ },
    texto: { pausa: 1500, invalido: /(?!)/ },
    nome: { pausa: 1500, invalido: /[\d@#$%&*_=+<>{}[\]|\\/^~`!?;:"()]/ },
    telefone: { pausa: 1800, invalido: /[^\d\s()+.\-]/ },
    email: { pausa: 1500, invalido: /\S\s+\S|@.*@/ },
  };

  function orientarAoDigitar(el, campo, revalidar, { pausa, invalido }) {
    let espera;
    el.addEventListener("input", () => {
      clearTimeout(espera);
      if (!el.value.trim()) {
        limparErro(campo);
        return;
      }
      if (temErro(campo) || invalido.test(el.value)) {
        revalidar();
        return;
      }
      espera = setTimeout(() => {
        if (el.value.trim() && document.activeElement === el) revalidar();
      }, pausa);
    });
    el.addEventListener("blur", () => clearTimeout(espera));
  }

  function ligarPergunta(p) {
    if (p.tipo === "escolha") return ligarCartoes(p);
    const el = $("#campo-" + p.chave);
    const revalidar = () => validarPergunta(p, true);

    if (p.tipo === "moeda") {
      const normalizar = (input) => {
        const lido = N.lerMoeda(input.value);
        if (lido.valor != null && lido.valor > 0) {
          input.value = N.formatarCentavos(lido.valor);
          return true;
        }
        return false;
      };
      ligarMascara(el, N.mascararMoedaDigitando, /[\d,]/, normalizar);
      el.addEventListener("blur", () => {
        if (el.value.trim()) revalidar();
        if (!temErro(p.chave)) normalizar(el);
      });
      if (p.naoSei) {
        el.addEventListener("input", () => naoSei[p.chave] && el.value && definirNaoSei(p, false));
        $("#naosei-" + p.chave).addEventListener("click", () => definirNaoSei(p, !naoSei[p.chave]));
      }
    } else {
      el.addEventListener("blur", () => el.value.trim() && revalidar());
    }
    // Mantém a resposta atualizada para quem depende dela (minimoDe, linha do tempo), sem exibir erro.
    el.addEventListener("input", () => validarPergunta(p, false));
    orientarAoDigitar(el, p.chave, revalidar, ORIENTACAO[p.tipo]);
    if (p.linhaDoTempo) el.addEventListener("input", () => atualizarLinhaDoTempo(p));
  }

  function definirNaoSei(p, ativo) {
    naoSei[p.chave] = ativo;
    $("#naosei-" + p.chave).setAttribute("aria-pressed", String(ativo));
    $("#caixa-" + p.chave).classList.toggle("desativado", ativo);
    if (ativo) {
      $("#campo-" + p.chave).value = "";
      respostas[p.chave] = N.NAO_SEI;
      limparErro(p.chave);
    } else {
      delete respostas[p.chave];
    }
  }

  function ligarIdentificacao() {
    const tel = $("#telefone");
    const normalizarTel = (input) => {
      const r = N.normalizarTelefone(input.value, lib, { apenasBrasil: cfg.APENAS_BRASIL !== false });
      if (r.ok && r.exibicao !== input.value) {
        input.value = r.exibicao;
        input.setSelectionRange?.(r.exibicao.length, r.exibicao.length);
      }
      return r.ok;
    };
    ligarMascara(tel, N.mascararTelefoneDigitando, /[\d+]/, normalizarTel);
    tel.addEventListener("change", () => normalizarTel(tel));

    const regras = [
      ["nome", (el) => N.validarNome(el.value), (el, r) => r.ok && r.valor !== el.value && (el.value = r.valor)],
      ["telefone", (el) => N.normalizarTelefone(el.value, lib, { apenasBrasil: cfg.APENAS_BRASIL !== false }), () => {}],
      ["email", (el) => N.validarEmail(el.value, true), (el, r) => r.ok && r.valor && r.valor !== el.value && (el.value = r.valor)],
    ];
    for (const [campo, validar, ajustar] of regras) {
      const el = $("#" + campo);
      el.addEventListener("blur", () => {
        if (!el.value.trim()) return;
        const r = validar(el);
        ajustar(el, r);
        aplicar(campo, r, true);
      });
      orientarAoDigitar(el, campo, () => aplicar(campo, validar(el), true), ORIENTACAO[campo]);
    }
    $("#consentimento").addEventListener("change", () => limparErro("consentimento"));
  }

  // ------------------------------------------------------------------
  // Ao abrir uma pergunta: revalida dependências e desenha a linha do tempo
  // ------------------------------------------------------------------
  function aoEntrar(p) {
    const el = p.tipo === "escolha" ? null : $("#campo-" + p.chave);
    // Revalida quando uma resposta anterior mudou depois que esta foi dada.
    if (el && el.value.trim() && (p.minimoDe || p.linhaDoTempo)) validarPergunta(p, true);
    if (p.linhaDoTempo) atualizarLinhaDoTempo(p);
  }

  /** Só a diferença entre as idades informadas; não é projeção financeira. */
  function atualizarLinhaDoTempo(p) {
    const caixa = $("#lt-" + p.chave);
    const de = respostas[p.linhaDoTempo.de];
    const r = N.validarResposta(p, $("#campo-" + p.chave).value, respostas);
    const anos = r.ok && r.valor != null ? N.horizonteEmAnos(de, r.valor) : null;
    if (anos == null) {
      caixa.hidden = true;
      caixa.innerHTML = "";
      return;
    }
    const passo = anos > 60 ? 10 : anos > 30 ? 5 : 1;
    let marcas = "";
    for (let a = passo; a < anos; a += passo) marcas += `<span class="lt-marca" style="left:${(a / anos) * 100}%"></span>`;
    caixa.innerHTML = `
      <p class="lt-titulo">${esc(p.linhaDoTempo.titulo || "Seu horizonte")}</p>
      <div class="lt-trilho${anos === 0 ? " lt-zero" : ""}">
        <span class="lt-preenchido"></span>${marcas}
        <span class="lt-ponto lt-inicio"></span><span class="lt-ponto lt-fim"></span>
      </div>
      <div class="lt-legendas">
        <span><small>Hoje</small><strong>${plural(de)}</strong></span>
        <span class="lt-horizonte"><strong>${plural(anos)}</strong><small>até o objetivo</small></span>
        <span><small>Objetivo</small><strong>${plural(r.valor)}</strong></span>
      </div>`;
    caixa.hidden = false;
  }

  // ------------------------------------------------------------------
  // Envio
  // ------------------------------------------------------------------
  const MENSAGENS_FALHA = {
    indisponivel: "Não foi possível concluir o envio agora. Suas respostas continuam aqui. Tente novamente em instantes.",
    offline: "Você parece estar sem conexão. Suas respostas continuam aqui. Verifique a internet e tente novamente.",
    limite: "Recebemos muitas tentativas em sequência. Aguarde um minuto e tente novamente.",
    invalido: "Algumas informações não puderam ser aceitas. Revise e tente novamente.",
    configuracao: "O envio está temporariamente indisponível. Suas respostas continuam aqui. Tente novamente mais tarde.",
  };

  /** Congela o corpo do envio: o mesmo conteúdo reaproveita id e corpo byte a byte. */
  function corpoDoEnvio(novoIdForcado) {
    const conteudo = { respostas: { ...respostas }, ...dados };
    const contexto = {
      linkCodigo: S.sessao.linkCodigo,
      utm: S.sessao.utm,
      referenciaDominio: S.sessao.referencia,
      armadilha: $("#site").value,
    };
    const chave = JSON.stringify([conteudo, contexto]);
    if (novoIdForcado || !ui.envio || ui.envio.chave !== chave) {
      const corpo = N.montarEnvio(conteudo, {
        ...contexto,
        id: S.novoId(),
        versaoFormulario: F.versao,
        sessaoId: S.sessao.id,
        dispositivo: S.categoriaDispositivo(),
        duracaoSegundos: ui.inicioEm ? Math.round((performance.now() - ui.inicioEm) / 1000) : null,
        privacidadeVersao: cfg.PRIVACIDADE_VERSAO,
      });
      ui.envio = { chave, json: JSON.stringify(corpo) };
    }
    return ui.envio.json;
  }

  async function concluir() {
    if (ui.enviando) return;
    for (const tela of ORDEM.slice(1, -1)) {
      if (!validarTela(tela, true)) {
        if (tela !== "identificacao") irPara(tela);
        return;
      }
    }

    definirEnviando(true);
    S.registrarEvento("tentativa_envio");
    let resultado = await S.enviar(corpoDoEnvio());
    if (!resultado.ok && resultado.tipo === "id_conflito") {
      // Mesmo id com outro corpo: gera um id novo e reenvia uma vez.
      resultado = await S.enviar(corpoDoEnvio(true));
    }
    definirEnviando(false);

    if (resultado.ok) {
      ui.concluido = true;
      S.registrarEvento("concluido");
      S.encerrarSessao(); // um novo envio nesta aba começa com contexto de origem próprio
      montarResumo();
      irPara("sucesso", { historico: false });
      history.replaceState({ tela: "sucesso" }, "", location.pathname + location.search);
      return;
    }
    S.registrarEvento("falha_envio");

    if (resultado.tipo === "invalido") {
      const conhecidos = ORDEM.concat(IDENTIFICACAO);
      const alvos = (resultado.campos || []).map(N.campoDoCaminho).filter((a) => a && conhecidos.includes(a[1]));
      // Navega primeiro: ao abrir a etapa, a revalidação local não pode apagar o aviso do servidor.
      const voltarPara = alvos.length && alvos[0][0] !== "identificacao" ? alvos[0][0] : null;
      if (voltarPara) irPara(voltarPara);
      for (const [, campo] of alvos) mostrarErro(campo, "Revise esta informação.");
      if (voltarPara) return;
    }
    const alerta = $("#alerta-envio");
    alerta.textContent = MENSAGENS_FALHA[resultado.tipo] || MENSAGENS_FALHA.indisponivel;
    alerta.hidden = false;
    $("#concluir .botao-texto").textContent = "Tentar novamente";
  }

  function definirEnviando(ativo) {
    ui.enviando = ativo;
    const botao = $("#concluir");
    botao.disabled = ativo;
    botao.classList.toggle("carregando", ativo);
    botao.setAttribute("aria-busy", String(ativo));
    if (ativo) {
      $("#alerta-envio").hidden = true;
      $(".botao-texto", botao).textContent = "Enviando…";
    } else if (!ui.concluido) {
      $(".botao-texto", botao).textContent = "Concluir";
    }
    $("#voltar").disabled = ativo;
    for (const el of $$("#form-dados input")) el.readOnly = ativo;
  }

  function montarResumo() {
    const dl = $("#resumo");
    dl.textContent = "";
    for (const { pergunta, resposta } of N.respostasLegiveis(F, respostas, "resumo")) {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = pergunta;
      dd.textContent = resposta;
      div.append(dt, dd);
      dl.append(div);
    }
  }

  // ------------------------------------------------------------------
  // Início: atribuição, link e eventos
  // ------------------------------------------------------------------
  function prepararPrivacidade() {
    const link = $("#link-politica");
    if (cfg.POLITICA_PRIVACIDADE_URL) link.href = cfg.POLITICA_PRIVACIDADE_URL;
    else {
      link.removeAttribute("href");
      link.classList.add("pendente");
      console.warn("[planejamento] POLITICA_PRIVACIDADE_URL não configurada.");
    }
    $("#bloco-consentimento").hidden = !cfg.CONSENTIMENTO_EXPLICITO;
  }

  async function iniciar() {
    montarTelas();
    PERGUNTAS.forEach(ligarPergunta);
    ligarIdentificacao();
    prepararPrivacidade();

    // Contexto de origem: capturado uma vez por sessão da aba.
    const sessao = S.sessao;
    const utmDaUrl = N.lerUtms(location.search);
    if (!sessao.iniciada || Object.keys(utmDaUrl).length) sessao.utm = utmDaUrl;
    if (!sessao.iniciada) {
      sessao.referencia = N.dominioDeReferencia(document.referrer, location.hostname);
      sessao.iniciada = true;
    }
    const codigo = N.lerCodigoDoCaminho(location.pathname);
    if (codigo && typeof codigo === "string") sessao.linkCodigo = codigo;
    S.gravarSessao(sessao);

    $("#comecar").addEventListener("click", () => {
      if (!ui.inicioEm) {
        ui.inicioEm = performance.now();
        S.registrarEvento("inicio");
      }
      irPara(ORDEM[1]);
    });
    $("#voltar").addEventListener("click", () => !ui.enviando && history.back());
    for (const form of $$("form.formulario")) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        avancar();
      });
    }

    history.replaceState({ tela: "inicio" }, "", location.pathname + location.search);

    if (codigo && typeof codigo === "object") return mostrarIndisponivel();
    if (codigo) {
      const situacao = await S.verificarLink(codigo);
      if (situacao === "inativo") return mostrarIndisponivel();
    }
    irPara("inicio", { historico: false });
    S.registrarEvento("visita");
  }

  function mostrarIndisponivel() {
    // Sem atribuição: o link inválido/desativado não capta em nome de ninguém.
    S.sessao.linkCodigo = null;
    S.gravarSessao(S.sessao);
    const seguir = $("#seguir-direto");
    if (cfg.LINK_INATIVO_PERMITE_DIRETO) {
      $("#indisponivel-texto").textContent =
        "O endereço que você acessou foi encerrado ou não existe. Se quiser, você ainda pode nos contar sobre seus planos.";
      const utms = new URLSearchParams(location.search);
      seguir.href = "/planejamento/" + (utms.toString() ? "?" + utms.toString() : "");
    } else {
      seguir.hidden = true;
    }
    irPara("indisponivel", { historico: false });
  }

  iniciar();
})();
