/**
 * Comunicação com o Worker do site (/planejamento/api):
 * verificação do link, envio idempotente e eventos (sem dados pessoais ou financeiros).
 */
(function () {
  "use strict";

  const cfg = window.CAIS_PLANEJAMENTO_CONFIG || {};
  const parametros = new URLSearchParams(location.search);
  // Máquina local ou rede interna (teste no celular pelo IP do computador).
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
  const simulando = !!(cfg.SIMULAR_EM_LOCALHOST && local && parametros.get("api") !== "real");
  const automatizado = navigator.webdriver === true && !local;
  const base = (cfg.API_BASE || "").replace(/\/$/, "");

  const ESPERAS_RETRY_MS = [1000, 3000, 9000];
  // O Worker pode tentar o CRM até 3 vezes (10 s cada, com orçamento de ~12 s para novas tentativas).
  const TIMEOUT_MS = 25000;
  const LIMITE_RETRY_AFTER_MS = 30000;

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  function novoId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Sessão da aba: só identificadores operacionais (nada pessoal ou financeiro).
  const CHAVE_SESSAO = "cais_planejamento_sessao";
  function lerSessao() {
    try {
      const salvo = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || "null");
      if (salvo && salvo.id) return salvo;
    } catch (_) {}
    return { id: novoId() };
  }
  function gravarSessao(s) {
    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
    } catch (_) {}
  }
  function encerrarSessao() {
    try {
      sessionStorage.removeItem(CHAVE_SESSAO);
    } catch (_) {}
  }

  const sessao = lerSessao();
  gravarSessao(sessao);

  function categoriaDispositivo() {
    const grosso = matchMedia("(pointer: coarse)").matches;
    const menor = Math.min(screen.width || 0, screen.height || 0);
    if (grosso && menor && menor < 600) return "mobile";
    if (grosso) return "tablet";
    return "desktop";
  }

  // ------------------------------------------------------------------
  // POST /eventos — { sessao_id, link?, evento, etapa?, form_versao }
  // ------------------------------------------------------------------
  const EVENTOS = new Set(["visita", "inicio", "etapa", "tentativa_envio", "falha_envio", "concluido"]);

  function registrarEvento(evento, etapa) {
    if (!EVENTOS.has(evento)) return;
    const corpo = { sessao_id: sessao.id };
    if (sessao.linkCodigo) corpo.link = sessao.linkCodigo;
    corpo.evento = evento;
    if (evento === "etapa") corpo.etapa = etapa;
    corpo.form_versao = cfg.FORM_VERSAO;

    if (simulando || !base || automatizado) {
      if (local) console.debug("[evento]", corpo);
      return;
    }
    const json = JSON.stringify(corpo);
    const url = `${base}/eventos`;
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([json], { type: "text/plain;charset=UTF-8" }))) return;
    } catch (_) {}
    fetch(url, {
      method: "POST",
      body: json,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  }

  // ------------------------------------------------------------------
  // GET /link/{codigo} — só para a tela de link indisponível
  // @returns {Promise<"ativo"|"inativo"|"desconhecido">}
  // ------------------------------------------------------------------
  async function verificarLink(codigo) {
    if (simulando) return codigo === "inativo" ? "inativo" : "ativo";
    if (!base) return "desconhecido";
    try {
      const r = await comTimeout(`${base}/link/${encodeURIComponent(codigo)}`, { credentials: "omit" }, 6000);
      if (r.status === 400) return "inativo";
      if (!r.ok) return "desconhecido"; // 503: segue o formulário e o CRM decide ao gravar
      const corpo = await r.json();
      return corpo && corpo.ativo === true ? "ativo" : "inativo";
    } catch (_) {
      return "desconhecido";
    }
  }

  async function comTimeout(url, opcoes, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opcoes, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  // ------------------------------------------------------------------
  // POST /envios
  // `corpoJson` é a string exata do envio: retries mandam o mesmo corpo byte a byte.
  // @returns {Promise<{ok:true} | {ok:false, tipo:"invalido", campos:string[]} |
  //                   {ok:false, tipo:"id_conflito"|"indisponivel"|"offline"|"limite"|"configuracao"}>}
  // ------------------------------------------------------------------
  async function enviar(corpoJson) {
    if (simulando) return enviarSimulado(corpoJson);
    if (!base) return { ok: false, tipo: "configuracao" };

    for (let tentativa = 0; ; tentativa++) {
      let r;
      try {
        r = await comTimeout(
          `${base}/envios`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: corpoJson, credentials: "omit" },
          TIMEOUT_MS
        );
      } catch (_) {
        r = null; // rede ou timeout
      }

      if (r) {
        let corpo = null;
        try {
          corpo = await r.json();
        } catch (_) {}
        const codigo = corpo && corpo.erro && corpo.erro.codigo;

        if ((r.status === 200 || r.status === 201) && corpo && corpo.recebido === true) return { ok: true };
        if (r.status === 409) return { ok: false, tipo: "id_conflito" };
        if (r.status === 400) {
          return { ok: false, tipo: "invalido", campos: (corpo && corpo.erro && corpo.erro.campos) || [] };
        }
        if (r.status === 429) {
          const espera = segundosRetryAfter(r.headers.get("Retry-After"));
          if (espera != null && espera <= LIMITE_RETRY_AFTER_MS && tentativa < ESPERAS_RETRY_MS.length) {
            await dormir(espera);
            continue;
          }
          return { ok: false, tipo: "limite" };
        }
        if (r.status < 500) return { ok: false, tipo: "configuracao", codigo }; // 403, 413, 415…
      }

      // 5xx, timeout ou rede: tenta de novo com o mesmo corpo em 1 s, 3 s e 9 s.
      if (tentativa < ESPERAS_RETRY_MS.length) {
        await dormir(ESPERAS_RETRY_MS[tentativa]);
        continue;
      }
      return { ok: false, tipo: navigator.onLine === false ? "offline" : "indisponivel" };
    }
  }

  function segundosRetryAfter(valor) {
    if (!valor) return 5000;
    const s = Number(valor);
    if (Number.isFinite(s)) return Math.max(0, s * 1000);
    const data = Date.parse(valor);
    return Number.isNaN(data) ? 5000 : Math.max(0, data - Date.now());
  }

  async function enviarSimulado(corpoJson) {
    await dormir(900);
    if (parametros.get("simular") === "falha") return { ok: false, tipo: "indisponivel" };
    console.info("[simulação] POST /envios", JSON.parse(corpoJson));
    return { ok: true };
  }

  window.CaisPlanejamentoServicos = {
    sessao,
    gravarSessao,
    encerrarSessao,
    novoId,
    categoriaDispositivo,
    registrarEvento,
    verificarLink,
    enviar,
    simulando,
  };
})();
