/**
 * CAIS · Planejamento — fluxo conversacional (uma pergunta por vez).
 * Respostas ficam só em memória; nada pessoal ou financeiro é gravado no navegador.
 */
(function () {
  "use strict";

  const N = window.CaisPlanejamento;
  const S = window.CaisPlanejamentoServicos;
  const cfg = window.CAIS_PLANEJAMENTO_CONFIG || {};
  const lib = window.libphonenumber;
  const REGRAS_IDADE = { minima: cfg.IDADE_MINIMA ?? null, maxima: cfg.IDADE_MAXIMA ?? null };
  const reduzirMovimento = matchMedia("(prefers-reduced-motion: reduce)");

  const ORDEM = ["inicio", "patrimonio", "experiencia", "aporte", "idade_atual", "idade_objetivo", "renda", "identificacao", "sucesso"];
  const TOTAL_ETAPAS = 7;

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const estado = {
    patrimonio_faixa: null,
    experiencia_faixa: null,
    aporte_faixa: null,
    idade_atual: null,
    idade_objetivo: null,
    renda_desejada_centavos: null,
    renda_desejada_indefinida: false,
    nome: null,
    telefone_e164: null,
    email: null,
  };

  const ui = {
    telaAtual: null,
    alcancada: 0, // maior índice já liberado
    inicioEm: null,
    enviando: false,
    concluido: false,
    envio: null, // { chave, json } — corpo congelado do envio atual
    etapasRegistradas: new Set(),
  };

  // ------------------------------------------------------------------
  // Ícones discretos das alternativas
  // ------------------------------------------------------------------
  const ICONES = {
    patrimonio: [
      '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/>',
      '<ellipse cx="12" cy="9" rx="6.5" ry="2.5"/><path d="M5.5 9v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V9"/><path d="M5.5 12v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-3"/>',
      '<path d="M4 20h16"/><path d="M6 20v-6M10 20V10M14 20V12M18 20V6"/>',
      '<path d="M4 20h16"/><path d="M6 20V9l6-4 6 4v11"/><path d="M10 20v-5h4v5"/>',
      '<path d="M12 3l7 9-7 9-7-9z"/><path d="M5 12h14M12 3v18"/>',
    ],
    experiencia: [
      '<path d="M12 20v-7"/><path d="M12 13c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6z"/><path d="M12 15c0-3 2-5.5 6-5.5 0 3-2 5.5-6 5.5z"/>',
      '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/><circle cx="9" cy="14.5" r="1"/>',
      '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M8 14.5h1M11.5 14.5h1M15 14.5h1M8 17.5h1M11.5 17.5h1"/>',
      '<path d="M4 18l5-5 3.5 3.5L20 9"/><path d="M15 9h5v5"/>',
    ],
  };

  function svgIcone(conteudo) {
    return `<svg class="cartao-icone" viewBox="0 0 24 24" aria-hidden="true">${conteudo}</svg>`;
  }

  function svgBarras(nivel) {
    const alturas = [6, 10, 14, 18];
    const barras = alturas
      .map((a, i) => `<rect class="${i < nivel ? "cheia" : "vazia"}" x="${2 + i * 5.5}" y="${21 - a}" width="3.6" height="${a}" rx="1"/>`)
      .join("");
    return `<svg class="cartao-icone barras" viewBox="0 0 24 24" aria-hidden="true">${barras}</svg>`;
  }

  function montarCartoes() {
    for (const recipiente of $$(".cartoes")) {
      const grupo = recipiente.dataset.grupo;
      recipiente.setAttribute("role", "radiogroup");
      recipiente.innerHTML = N.FAIXAS[grupo]
        .map((f, i) => {
          const icone = grupo === "aporte" ? svgBarras(i + 1) : svgIcone(ICONES[grupo][i]);
          return `<label class="cartao">
            <input type="radio" name="${grupo}" value="${f.chave}" />
            ${icone}
            <span class="cartao-texto">${f.rotulo}</span>
            <span class="cartao-marca" aria-hidden="true"></span>
          </label>`;
        })
        .join("");
      recipiente.setAttribute("aria-labelledby", `t-${grupo}`);

      let ultimoToque = 0;
      recipiente.addEventListener("pointerdown", () => (ultimoToque = Date.now()));
      recipiente.addEventListener("change", (e) => {
        estado[`${grupo}_faixa`] = e.target.value;
        limparErro(grupo);
        // Toque/clique avança sozinho; setas do teclado só mudam a seleção.
        if (Date.now() - ultimoToque < 1200) {
          const tela = ui.telaAtual;
          setTimeout(() => ui.telaAtual === tela && avancar(), reduzirMovimento.matches ? 120 : 380);
        }
      });
      // Tocar de novo numa opção já escolhida (ao voltar) também avança.
      recipiente.addEventListener("click", (e) => {
        const input = e.target.closest(".cartao")?.querySelector("input");
        if (!input || e.detail === 0) return;
        if (input.checked && estado[`${grupo}_faixa`] === input.value && Date.now() - ultimoToque < 1200) {
          const tela = ui.telaAtual;
          setTimeout(() => ui.telaAtual === tela && avancar(), 200);
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // Erros por campo
  // ------------------------------------------------------------------
  const CAMPOS = {
    patrimonio: { erro: "erro-patrimonio" },
    experiencia: { erro: "erro-experiencia" },
    aporte: { erro: "erro-aporte" },
    idade_atual: { erro: "erro-idade-atual", input: "idade-atual" },
    idade_objetivo: { erro: "erro-idade-objetivo", input: "idade-objetivo" },
    renda: { erro: "erro-renda", input: "renda" },
    nome: { erro: "erro-nome", input: "nome" },
    telefone: { erro: "erro-telefone", input: "telefone" },
    email: { erro: "erro-email", input: "email" },
    consentimento: { erro: "erro-consentimento", input: "consentimento" },
  };

  function mostrarErro(campo, mensagem) {
    const c = CAMPOS[campo];
    $("#" + c.erro).textContent = mensagem;
    if (c.input) $("#" + c.input).setAttribute("aria-invalid", "true");
    else $(`[data-grupo="${campo}"]`).setAttribute("aria-invalid", "true");
  }

  function limparErro(campo) {
    const c = CAMPOS[campo];
    $("#" + c.erro).textContent = "";
    if (c.input) $("#" + c.input).removeAttribute("aria-invalid");
    else $(`[data-grupo="${campo}"]`).removeAttribute("aria-invalid");
  }

  const temErro = (campo) => !!$("#" + CAMPOS[campo].erro).textContent;

  // ------------------------------------------------------------------
  // Validação por etapa (mostrar=false só consulta, sem exibir mensagens)
  // ------------------------------------------------------------------
  const VALIDADORES = {
    patrimonio: (mostrar) => validarGrupo("patrimonio", "Selecione a faixa do seu patrimônio para continuar.", mostrar),
    experiencia: (mostrar) => validarGrupo("experiencia", "Selecione há quanto tempo você investe para continuar.", mostrar),
    aporte: (mostrar) => validarGrupo("aporte", "Selecione quanto da sua renda você consegue investir.", mostrar),
    idade_atual(mostrar) {
      const r = N.validarIdade($("#idade-atual").value, REGRAS_IDADE);
      estado.idade_atual = r.ok ? r.valor : null;
      return aplicar("idade_atual", r, mostrar);
    },
    idade_objetivo(mostrar) {
      const r = N.validarIdadeObjetivo($("#idade-objetivo").value, estado.idade_atual, REGRAS_IDADE);
      estado.idade_objetivo = r.ok ? r.valor : null;
      return aplicar("idade_objetivo", r, mostrar);
    },
    renda(mostrar) {
      const r = N.validarRenda($("#renda").value, estado.renda_desejada_indefinida);
      estado.renda_desejada_centavos = r.ok ? r.centavos : null;
      return aplicar("renda", r, mostrar);
    },
    identificacao(mostrar) {
      const nome = N.validarNome($("#nome").value);
      estado.nome = nome.ok ? nome.valor : null;
      const tel = N.normalizarTelefone($("#telefone").value, lib, { apenasBrasil: cfg.APENAS_BRASIL !== false });
      estado.telefone_e164 = tel.ok ? tel.e164 : null;
      const email = N.validarEmail($("#email").value);
      estado.email = email.ok ? email.valor : null;
      let consentimento = { ok: true };
      if (cfg.CONSENTIMENTO_EXPLICITO && !$("#consentimento").checked) {
        consentimento = { ok: false, erro: "Para continuar, confirme que concorda com o tratamento dos seus dados." };
      }
      const resultados = [
        aplicar("nome", nome, mostrar),
        aplicar("telefone", tel, mostrar),
        aplicar("email", email, mostrar),
        aplicar("consentimento", consentimento, mostrar),
      ];
      return resultados.every(Boolean);
    },
  };

  function validarGrupo(grupo, mensagem, mostrar) {
    const ok = N.faixaValida(grupo, estado[`${grupo}_faixa`]);
    return aplicar(grupo, ok ? { ok } : { ok, erro: mensagem }, mostrar);
  }

  function aplicar(campo, resultado, mostrar) {
    if (resultado.ok) limparErro(campo);
    else if (mostrar) mostrarErro(campo, resultado.erro);
    return resultado.ok;
  }

  // ------------------------------------------------------------------
  // Navegação
  // ------------------------------------------------------------------
  function irPara(tela, { direcao = "frente", historico = true } = {}) {
    const atual = ui.telaAtual ? $(`[data-tela="${ui.telaAtual}"]`) : null;
    const proxima = $(`[data-tela="${tela}"]`);
    if (!proxima || atual === proxima) return;

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
    if (indice > ui.alcancada) ui.alcancada = indice;
    atualizarTopo(tela, indice);
    if (historico) history.pushState({ tela }, "", location.pathname + location.search);

    if (tela === "idade_objetivo") aoEntrarIdadeObjetivo();
    focarTela(proxima, tela);

    if (indice >= 1 && indice <= TOTAL_ETAPAS && !ui.etapasRegistradas.has(indice)) {
      ui.etapasRegistradas.add(indice);
      S.registrarEvento("etapa", indice);
    }
  }

  function focarTela(secao, tela) {
    const campo = { idade_atual: "#idade-atual", idade_objetivo: "#idade-objetivo", renda: "#renda" }[tela];
    const escolhido = $("input[type=radio]:checked", secao);
    // Foco síncrono: quem digita rápido logo após "Enter" não perde caracteres.
    if (campo && !(tela === "renda" && estado.renda_desejada_indefinida)) $(campo).focus({ preventScroll: true });
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
    $("#progresso").setAttribute("aria-valuenow", String(feito));
    $("#progresso").setAttribute("aria-valuetext", emEtapa ? `Etapa ${indice} de ${TOTAL_ETAPAS}` : "Concluído");
    $("#etapa-atual").textContent = emEtapa ? `Etapa ${indice} de ${TOTAL_ETAPAS}` : "";
    document.body.dataset.telaAtual = tela;
  }

  function avancar() {
    const tela = ui.telaAtual;
    const validar = VALIDADORES[tela];
    if (validar && !validar(true)) {
      const c = CAMPOS[tela === "identificacao" ? primeiroCampoComErro() : tela];
      if (c && c.input) $("#" + c.input).focus();
      return;
    }
    if (tela === "identificacao") return concluir();
    irPara(ORDEM[ORDEM.indexOf(tela) + 1]);
  }

  function voltar() {
    if (ui.enviando) return;
    history.back();
  }

  function primeiroCampoComErro() {
    return ["nome", "telefone", "email", "consentimento"].find(temErro) || "nome";
  }

  window.addEventListener("popstate", (e) => {
    const destino = e.state && e.state.tela;
    if (ui.concluido) {
      history.pushState({ tela: "sucesso" }, "", location.pathname + location.search);
      return;
    }
    if (ui.enviando) {
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
        const v = VALIDADORES[ORDEM[i]];
        if (v && !v(false)) {
          irPara(ORDEM[i], { historico: false });
          history.replaceState({ tela: ORDEM[i] }, "", location.pathname + location.search);
          return;
        }
      }
    }
    irPara(destino, { direcao: alvo < atual ? "tras" : "frente", historico: false });
  });

  // ------------------------------------------------------------------
  // Campos com máscara (telefone e moeda)
  // ------------------------------------------------------------------
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
      const emBloco = !e.inputType || e.inputType === "insertFromPaste" || e.inputType === "insertReplacementText" || e.inputType === "insertFromDrop";
      if (emBloco && aoColar(input)) return;
      aplicarMascara(input.selectionStart);
    });
  }

  function ligarCampos() {
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

    const renda = $("#renda");
    const normalizarRenda = (input) => {
      const lido = N.lerMoeda(input.value);
      if (lido.valor != null && lido.valor > 0) {
        input.value = N.formatarCentavos(lido.valor);
        return true;
      }
      return false;
    };
    ligarMascara(renda, N.mascararMoedaDigitando, /[\d,]/, normalizarRenda);
    renda.addEventListener("input", () => {
      if (estado.renda_desejada_indefinida && renda.value) definirNaoSei(false);
    });

    // Validação ao sair do campo (só se algo foi digitado) e orientação durante a digitação.
    const mapa = [
      ["idade-atual", "idade_atual", () => VALIDADORES.idade_atual],
      ["idade-objetivo", "idade_objetivo", () => VALIDADORES.idade_objetivo],
      ["renda", "renda", () => VALIDADORES.renda],
    ];
    for (const [id, campo, v] of mapa) {
      const el = $("#" + id);
      el.addEventListener("blur", () => {
        if (el.value.trim()) v()(true);
        if (campo === "renda" && !temErro("renda")) normalizarRenda(el);
      });
      orientarAoDigitar(el, campo, () => v()(true), ORIENTACAO[campo]);
    }
    $("#idade-objetivo").addEventListener("input", atualizarLinhaDoTempo);
    $("#idade-atual").addEventListener("input", () => {
      // Resposta anterior mudou: a etapa dependente será revalidada ao reabrir.
      VALIDADORES.idade_atual(false);
    });

    const dados = [
      ["nome", (el) => N.validarNome(el.value), (el, r) => r.ok && r.valor !== el.value && (el.value = r.valor)],
      ["telefone", (el) => N.normalizarTelefone(el.value, lib, { apenasBrasil: cfg.APENAS_BRASIL !== false }), () => {}],
      ["email", (el) => N.validarEmail(el.value), (el, r) => r.ok && r.valor && r.valor !== el.value && (el.value = r.valor)],
    ];
    for (const [campo, validar, ajustar] of dados) {
      const el = $("#" + campo);
      el.addEventListener("blur", () => {
        if (!el.value.trim() && campo !== "email") return;
        const r = validar(el);
        ajustar(el, r);
        aplicar(campo, r, true);
      });
      orientarAoDigitar(el, campo, () => aplicar(campo, validar(el), true), ORIENTACAO[campo]);
    }
    $("#consentimento").addEventListener("change", () => limparErro("consentimento"));

    $("#renda-nao-sei").addEventListener("click", () => definirNaoSei(!estado.renda_desejada_indefinida));
  }

  /**
   * Orientação durante a digitação: caractere claramente inválido explica na hora;
   * o resto só depois de uma pausa (quem digita "1" a caminho de "18" não vê erro).
   * Com erro já visível, revalida a cada tecla para a mensagem sumir assim que corrigir.
   */
  const ORIENTACAO = {
    idade_atual: { pausa: 900, invalido: /[^\d\s]/ },
    idade_objetivo: { pausa: 900, invalido: /[^\d\s]/ },
    renda: { pausa: 1000, invalido: /[^\d.,\s]/ },
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

  function definirNaoSei(ativo) {
    estado.renda_desejada_indefinida = ativo;
    const botao = $("#renda-nao-sei");
    botao.setAttribute("aria-pressed", String(ativo));
    $("#campo-renda").classList.toggle("desativado", ativo);
    if (ativo) {
      $("#renda").value = "";
      estado.renda_desejada_centavos = null;
      limparErro("renda");
    }
  }

  // ------------------------------------------------------------------
  // Linha do tempo (só a diferença entre as idades; não é projeção financeira)
  // ------------------------------------------------------------------
  function aoEntrarIdadeObjetivo() {
    const el = $("#idade-objetivo");
    // Revalida quando a idade atual mudou depois que esta resposta foi dada.
    if (el.value.trim()) VALIDADORES.idade_objetivo(true);
    atualizarLinhaDoTempo();
  }

  function atualizarLinhaDoTempo() {
    const caixa = $("#linha-tempo");
    const r = N.validarIdadeObjetivo($("#idade-objetivo").value, estado.idade_atual, REGRAS_IDADE);
    const anos = r.ok ? N.horizonteEmAnos(estado.idade_atual, r.valor) : null;
    if (anos == null) {
      caixa.hidden = true;
      caixa.innerHTML = "";
      return;
    }
    const passo = anos > 60 ? 10 : anos > 30 ? 5 : 1;
    let marcas = "";
    for (let a = passo; a < anos; a += passo) {
      marcas += `<span class="lt-marca" style="left:${(a / anos) * 100}%"></span>`;
    }
    const plural = (n) => `${n} ${n === 1 ? "ano" : "anos"}`;
    caixa.innerHTML = `
      <p class="lt-titulo">Seu horizonte de planejamento</p>
      <div class="lt-trilho${anos === 0 ? " lt-zero" : ""}">
        <span class="lt-preenchido"></span>${marcas}
        <span class="lt-ponto lt-inicio"></span><span class="lt-ponto lt-fim"></span>
      </div>
      <div class="lt-legendas">
        <span><small>Hoje</small><strong>${plural(estado.idade_atual)}</strong></span>
        <span class="lt-horizonte"><strong>${plural(anos)}</strong><small>até o objetivo</small></span>
        <span><small>Objetivo</small><strong>${plural(r.valor)}</strong></span>
      </div>`;
    caixa.hidden = false;
  }

  // ------------------------------------------------------------------
  // Envio
  // ------------------------------------------------------------------
  function validarTudo() {
    for (const tela of ORDEM.slice(1, 8)) {
      if (!VALIDADORES[tela](true)) return tela;
    }
    return null;
  }

  const MENSAGENS_FALHA = {
    indisponivel: "Não foi possível concluir o envio agora. Suas respostas continuam aqui. Tente novamente em instantes.",
    offline: "Você parece estar sem conexão. Suas respostas continuam aqui. Verifique a internet e tente novamente.",
    limite: "Recebemos muitas tentativas em sequência. Aguarde um minuto e tente novamente.",
    invalido: "Algumas informações não puderam ser aceitas. Revise e tente novamente.",
    configuracao: "O envio está temporariamente indisponível. Suas respostas continuam aqui. Tente novamente mais tarde.",
  };

  /** Congela o corpo do envio: o mesmo conteúdo reaproveita id e corpo byte a byte. */
  function corpoDoEnvio(respostas, novoIdForcado) {
    const contexto = {
      linkCodigo: S.sessao.linkCodigo,
      utm: S.sessao.utm,
      referenciaDominio: S.sessao.referencia,
      armadilha: $("#site").value,
    };
    const chave = JSON.stringify([respostas, contexto]);
    if (novoIdForcado || !ui.envio || ui.envio.chave !== chave) {
      const corpo = N.montarEnvio(respostas, {
        ...contexto,
        id: S.novoId(),
        versaoFormulario: cfg.FORM_VERSAO,
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
    const pendente = validarTudo();
    if (pendente && pendente !== "identificacao") {
      irPara(pendente);
      return;
    }
    if (pendente) return;

    const respostas = { ...estado };
    definirEnviando(true);
    S.registrarEvento("tentativa_envio");
    let resultado = await S.enviar(corpoDoEnvio(respostas));
    if (!resultado.ok && resultado.tipo === "id_conflito") {
      // Mesmo id com outro corpo: gera um id novo e reenvia uma vez.
      resultado = await S.enviar(corpoDoEnvio(respostas, true));
    }
    definirEnviando(false);

    if (resultado.ok) {
      ui.concluido = true;
      S.registrarEvento("concluido");
      // Um novo envio nesta aba começa com contexto de origem próprio.
      S.encerrarSessao();
      montarResumo(respostas);
      irPara("sucesso", { historico: false });
      history.replaceState({ tela: "sucesso" }, "", location.pathname + location.search);
      return;
    }
    S.registrarEvento("falha_envio");

    if (resultado.tipo === "invalido") {
      const alvos = (resultado.campos || []).map(N.campoDoCaminho).filter(Boolean);
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

  function montarResumo(r) {
    const anos = N.horizonteEmAnos(r.idade_atual, r.idade_objetivo);
    const plural = (n) => `${n} ${n === 1 ? "ano" : "anos"}`;
    const linhas = [
      ["Patrimônio", N.rotuloDaFaixa("patrimonio", r.patrimonio_faixa)],
      ["Histórico de investimentos", N.rotuloDaFaixa("experiencia", r.experiencia_faixa)],
      ["Capacidade de aporte", `${N.rotuloDaFaixa("aporte", r.aporte_faixa)} da renda`],
      ["Idade pretendida", plural(r.idade_objetivo)],
      ["Horizonte de planejamento", plural(anos)],
    ];
    if (!r.renda_desejada_indefinida && r.renda_desejada_centavos) {
      linhas.push(["Renda mensal desejada", N.formatarMoeda(r.renda_desejada_centavos)]);
    }
    const dl = $("#resumo");
    dl.textContent = "";
    for (const [rotulo, valor] of linhas) {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = rotulo;
      dd.textContent = valor;
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
    if (REGRAS_IDADE.minima != null) {
      const nota = $("#regra-idade");
      nota.textContent = `Esta campanha é destinada a pessoas com ${REGRAS_IDADE.minima} anos ou mais.`;
      nota.hidden = false;
    }
  }

  async function iniciar() {
    montarCartoes();
    ligarCampos();
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
      irPara("patrimonio");
    });
    $("#voltar").addEventListener("click", voltar);
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
