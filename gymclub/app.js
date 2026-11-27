/**
 * Captação na Gym Club — cadastro rápido feito pelos colaboradores no evento.
 * Entrada: só o nome de quem cadastra (guardado no aparelho, segue em cada cadastro).
 * Cada cadastro entra primeiro numa fila no aparelho (localStorage) e só sai dela
 * quando o servidor confirma: sem sinal, nada se perde e o envio é refeito sozinho.
 */
(function () {
  "use strict";

  const N = window.CaisPlanejamento;
  const lib = window.libphonenumber;
  const API = "/gymclub/api/cadastros";
  const CHAVE_COLABORADOR = "cais_gymclub_colaborador";
  const CHAVE_FILA = "cais_gymclub_fila_v2";
  const CHAVE_RECUSADOS = "cais_gymclub_recusados_v2";
  const CHAVE_ENVIADOS = "cais_gymclub_enviados";
  const REENVIO_MS = 15000;

  const $ = (id) => document.getElementById(id);
  const entrada = $("entrada");
  const cadastro = $("cadastro");
  const colaborador = $("colaborador");
  const form = $("form");
  const nome = $("c-pessoa");
  const telefone = $("c-zap");
  const email = $("c-correio");
  const observacoes = $("c-obs");
  const situacao = $("situacao");
  const salvo = $("salvo");
  const recusados = $("recusados");

  // ---------- armazenamento no aparelho ----------
  function ler(chave, padrao) {
    try {
      const v = JSON.parse(localStorage.getItem(chave));
      return v == null ? padrao : v;
    } catch (_) {
      return padrao;
    }
  }
  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (_) {
      return false;
    }
  }
  // Se o navegador não deixar gravar, a fila e o nome vivem só na memória.
  let fila = ler(CHAVE_FILA, []);
  if (!Array.isArray(fila)) fila = [];
  const salvarFila = () => gravar(CHAVE_FILA, fila);
  let quem = ler(CHAVE_COLABORADOR, "");
  if (typeof quem !== "string") quem = "";

  function novoId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function marcar(campo, erro) {
    $("erro-" + campo.id).textContent = erro || "";
    if (erro) campo.setAttribute("aria-invalid", "true");
    else campo.removeAttribute("aria-invalid");
  }

  // ---------- entrada ----------
  function mostrarTela() {
    entrada.hidden = !!quem;
    cadastro.hidden = !quem;
    if (quem) {
      $("quem").textContent = quem;
      atualizarSituacao();
      nome.focus();
    } else {
      colaborador.focus();
    }
  }
  $("form-entrada").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = colaborador.value.trim() ? N.validarNome(colaborador.value) : { ok: false, erro: "Informe seu nome." };
    marcar(colaborador, v.ok ? "" : v.erro);
    if (!v.ok) return colaborador.focus();
    quem = v.valor;
    gravar(CHAVE_COLABORADOR, quem);
    mostrarTela();
    enviarFila();
  });
  colaborador.addEventListener("input", () => marcar(colaborador, ""));
  $("trocar").addEventListener("click", () => {
    colaborador.value = quem;
    quem = "";
    mostrarTela();
    colaborador.select();
  });

  // ---------- situação na tela ----------
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const contatoDe = (c) => [c.telefone, c.email].filter(Boolean).join(" / ");

  function atualizarSituacao() {
    const enviados = ler(CHAVE_ENVIADOS, 0);
    const partes = [];
    if (enviados) partes.push(plural(enviados, "cadastro enviado", "cadastros enviados"));
    if (fila.length) partes.push(`${fila.length} aguardando conexão`);
    situacao.textContent = partes.length ? partes.join(" · ") : "Nenhum cadastro neste aparelho ainda.";

    const lista = ler(CHAVE_RECUSADOS, []);
    recusados.hidden = !lista.length;
    if (lista.length) {
      recusados.textContent =
        `${plural(lista.length, "cadastro não foi aceito", "cadastros não foram aceitos")} pelo servidor: ` +
        lista.map((c) => `${c.nome} (${contatoDe(c)})`).join("; ") +
        ". Anote e avise o time.";
    }
  }

  let apagarSalvo;
  function mostrarSalvo(texto) {
    salvo.textContent = texto;
    salvo.hidden = false;
    clearTimeout(apagarSalvo);
    apagarSalvo = setTimeout(() => (salvo.hidden = true), 5000);
  }

  // ---------- envio ----------
  let enviando = false;
  async function enviarFila() {
    if (enviando) return;
    enviando = true;
    try {
      while (fila.length) {
        const item = fila[0];
        let r;
        try {
          r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
        } catch (_) {
          break; // sem conexão: tenta de novo depois
        }
        if (r.ok) {
          gravar(CHAVE_ENVIADOS, ler(CHAVE_ENVIADOS, 0) + 1);
        } else if (r.status === 400 || r.status === 413) {
          // O servidor recusou os dados: não adianta repetir. Fica à vista para ninguém perder o contato.
          gravar(CHAVE_RECUSADOS, [...ler(CHAVE_RECUSADOS, []), item]);
        } else {
          break; // limite ou indisponível: tenta de novo depois
        }
        fila.shift();
        salvarFila();
      }
    } finally {
      enviando = false;
      atualizarSituacao();
    }
  }

  // ---------- campos do cadastro ----------
  telefone.addEventListener("input", () => {
    const m = N.mascararTelefoneDigitando(telefone.value, telefone.selectionStart);
    telefone.value = m.valor;
    try {
      telefone.setSelectionRange(m.cursor, m.cursor);
    } catch (_) {}
  });
  for (const campo of [nome, telefone, email]) campo.addEventListener("input", () => marcar(campo, ""));

  // Atalhos de domínio: completam o e-mail sem precisar achar o @ no teclado.
  $("atalhos").addEventListener("click", (e) => {
    const dominio = e.target && e.target.dataset && e.target.dataset.dominio;
    if (!dominio) return;
    email.value = email.value.trim().split("@")[0] + "@" + dominio;
    marcar(email, "");
    observacoes.focus();
  });

  // "Seguinte" no teclado do celular leva ao próximo campo em vez de enviar.
  [nome, telefone, email].forEach((campo, i, lista) => {
    campo.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      (lista[i + 1] || observacoes).focus();
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const temTelefone = !!telefone.value.trim();
    const temEmail = !!email.value.trim();
    const vNome = nome.value.trim() ? N.validarNome(nome.value) : { ok: false, erro: "Informe o nome." };
    const vTelefone = temTelefone
      ? N.normalizarTelefone(telefone.value, lib, { apenasBrasil: true })
      : temEmail
      ? { ok: true, e164: null }
      : { ok: false, erro: "Informe o WhatsApp ou o e-mail." };
    const vEmail = temEmail ? N.validarEmail(email.value, true) : { ok: true, valor: null };
    marcar(nome, vNome.ok ? "" : vNome.erro);
    marcar(telefone, vTelefone.ok ? "" : vTelefone.erro);
    marcar(email, vEmail.ok ? "" : vEmail.erro);
    if (!vNome.ok) return nome.focus();
    if (!vTelefone.ok) return telefone.focus();
    if (!vEmail.ok) return email.focus();

    fila.push({
      id: novoId(),
      colaborador: quem,
      nome: vNome.valor,
      telefone: vTelefone.e164,
      email: vEmail.valor,
      observacoes: observacoes.value.trim(),
      criado_em: new Date().toISOString(),
    });
    const guardado = salvarFila();
    form.reset();
    mostrarSalvo(
      guardado ? `✓ ${vNome.valor} — cadastro salvo.` : `✓ ${vNome.valor} — salvo. Mantenha esta página aberta até enviar.`
    );
    atualizarSituacao();
    window.scrollTo({ top: 0 });
    nome.focus();
    enviarFila();
  });

  window.addEventListener("online", enviarFila);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && enviarFila());
  setInterval(enviarFila, REENVIO_MS);

  mostrarTela();
  enviarFila();
})();
