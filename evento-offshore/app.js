(function () {
  "use strict";

  var form = document.getElementById("rsvp-form");
  if (!form) return;

  var inputNome = document.getElementById("nome");
  var inputTelefone = document.getElementById("telefone");
  var inputEmail = document.getElementById("email");
  var inputCpf = document.getElementById("cpf");

  var errNome = document.getElementById("erro-nome");
  var errTelefone = document.getElementById("erro-telefone");
  var errEmail = document.getElementById("erro-email");
  var errCpf = document.getElementById("erro-cpf");

  var formAlert = document.getElementById("form-alert");
  var submitBtn = document.getElementById("submit-btn");
  var submitLabel = document.getElementById("submit-label");
  var submitSpinner = document.getElementById("submit-spinner");

  var formContainer = document.getElementById("form-container");
  var confirmView = document.getElementById("confirmation-view");
  var confirmGreeting = document.getElementById("confirm-greeting");
  var confirmMessage = document.getElementById("confirm-message");
  var confirmDate = document.getElementById("confirm-date");
  var confirmVenue = document.getElementById("confirm-venue");
  var calendarBtn = document.getElementById("add-calendar-btn");

  // Configurações padrão resilientes (evita falhas se config.js for bloqueado por ad-blocker)
  var DEFAULT_SUPABASE_URL = "https://laukfwrsdvchozgicjxm.supabase.co";
  var DEFAULT_SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdWtmd3JzZHZjaG96Z2ljanhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTc0MDEsImV4cCI6MjEwOTM5MzQwMX0.YL1UZkZlPFjWlpJkMUZjW-y7xU4c-D1KXYtQIiFkzMo";
  var DEFAULT_SUPABASE_TABLE = "evento_offshore_confirmacoes";

  // ---------------------------------------------------------------------------
  // 1. Personalização opcional via query param (?nome=...)
  // ---------------------------------------------------------------------------
  function applyPersonalization(rawNome) {
    var trimmedNome = String(rawNome || "").trim();
    if (!trimmedNome) return;

    if (!inputNome.value) {
      inputNome.value = trimmedNome;
    }
    var formTitle = document.getElementById("form-card-title");
    if (formTitle) {
      var firstName = trimmedNome.split(" ")[0];
      formTitle.textContent = "Olá, " + firstName + ". Confirme sua presença";
    }
  }

  try {
    var params = new URLSearchParams(window.location.search);
    var urlNome = params.get("nome") || params.get("n") || "";
    if (urlNome && urlNome.trim()) {
      applyPersonalization(urlNome.trim());
    }
  } catch (_) {}

  // ---------------------------------------------------------------------------
  // 2. Normalização e máscaras amigáveis a Backspace e Autofill (iOS / Android)
  // ---------------------------------------------------------------------------
  function onlyDigits(val) {
    return String(val || "").replace(/\D+/g, "");
  }

  function normalizeBrPhoneDigits(raw) {
    var str = String(raw || "").trim();
    var digits = onlyDigits(str);

    if (
      (str.indexOf("+55") === 0 && digits.length >= 12) ||
      (digits.indexOf("55") === 0 && (digits.length === 12 || digits.length === 13))
    ) {
      digits = digits.slice(2);
    }

    if (digits.length === 12 && digits.charAt(0) === "0") {
      digits = digits.slice(1);
    }

    return digits.slice(0, 11);
  }

  function formatPhone(digits) {
    if (!digits) return "";
    if (digits.length <= 2) {
      return "(" + digits;
    }
    if (digits.length <= 6) {
      return "(" + digits.slice(0, 2) + ") " + digits.slice(2);
    }
    if (digits.length <= 10) {
      return (
        "(" +
        digits.slice(0, 2) +
        ") " +
        digits.slice(2, 6) +
        "-" +
        digits.slice(6)
      );
    }
    return (
      "(" +
      digits.slice(0, 2) +
      ") " +
      digits.slice(2, 7) +
      "-" +
      digits.slice(7, 11)
    );
  }

  function formatCpf(digits) {
    var d = digits.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
    if (d.length <= 9) {
      return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    }
    return (
      d.slice(0, 3) +
      "." +
      d.slice(3, 6) +
      "." +
      d.slice(6, 9) +
      "-" +
      d.slice(9, 11)
    );
  }

  function applyMaskedValue(input, formatter, digitExtractor) {
    var raw = input.value;
    var selectionStart = input.selectionStart || raw.length;
    var digitsBeforeCursor = onlyDigits(raw.slice(0, selectionStart)).length;

    var cleanDigits = digitExtractor ? digitExtractor(raw) : onlyDigits(raw);
    var strippedPrefix = onlyDigits(raw).length - cleanDigits.length;
    if (strippedPrefix > 0) {
      digitsBeforeCursor = cleanDigits.length;
    }

    var formatted = formatter(cleanDigits);
    input.value = formatted;

    if (document.activeElement === input && input.setSelectionRange) {
      var pos = 0;
      var seenDigits = 0;
      while (pos < formatted.length && seenDigits < digitsBeforeCursor) {
        if (/\d/.test(formatted.charAt(pos))) {
          seenDigits++;
        }
        pos++;
      }
      try {
        input.setSelectionRange(pos, pos);
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Validações
  // ---------------------------------------------------------------------------
  function isValidCpf(raw) {
    var cpf = onlyDigits(raw);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    var sum = 0;
    for (var i = 0; i < 9; i++) {
      sum += parseInt(cpf.charAt(i), 10) * (10 - i);
    }
    var rem = (sum * 10) % 11;
    if (rem === 10) rem = 0;
    if (rem !== parseInt(cpf.charAt(9), 10)) return false;

    sum = 0;
    for (var j = 0; j < 10; j++) {
      sum += parseInt(cpf.charAt(j), 10) * (11 - j);
    }
    rem = (sum * 10) % 11;
    if (rem === 10) rem = 0;
    return rem === parseInt(cpf.charAt(10), 10);
  }

  function isValidPhone(raw) {
    var d = normalizeBrPhoneDigits(raw);
    if (d.length !== 10 && d.length !== 11) return false;
    var ddd = parseInt(d.slice(0, 2), 10);
    return ddd >= 11 && ddd <= 99;
  }

  function isValidEmail(raw) {
    var v = String(raw || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  function isValidNome(raw) {
    var v = String(raw || "").trim().replace(/\s+/g, " ");
    return v.length >= 2;
  }

  function setFieldError(input, errEl, message) {
    if (message) {
      input.setAttribute("aria-invalid", "true");
      errEl.textContent = message;
    } else {
      input.removeAttribute("aria-invalid");
      errEl.textContent = "";
    }
  }

  function validateField(input, showEmptyError) {
    var val = input.value;
    if (input === inputNome) {
      if (!val.trim()) {
        setFieldError(inputNome, errNome, showEmptyError ? "Informe seu nome." : "");
        return false;
      }
      if (!isValidNome(val)) {
        setFieldError(inputNome, errNome, "Informe seu nome completo.");
        return false;
      }
      setFieldError(inputNome, errNome, "");
      return true;
    }

    if (input === inputTelefone) {
      if (!onlyDigits(val)) {
        setFieldError(
          inputTelefone,
          errTelefone,
          showEmptyError ? "Informe seu telefone com DDD." : ""
        );
        return false;
      }
      if (!isValidPhone(val)) {
        setFieldError(inputTelefone, errTelefone, "Digite um telefone válido com DDD.");
        return false;
      }
      setFieldError(inputTelefone, errTelefone, "");
      return true;
    }

    if (input === inputEmail) {
      if (!val.trim()) {
        setFieldError(inputEmail, errEmail, showEmptyError ? "Informe seu e-mail." : "");
        return false;
      }
      if (!isValidEmail(val)) {
        setFieldError(inputEmail, errEmail, "Digite um endereço de e-mail válido.");
        return false;
      }
      setFieldError(inputEmail, errEmail, "");
      return true;
    }

    if (input === inputCpf) {
      if (!onlyDigits(val)) {
        setFieldError(inputCpf, errCpf, showEmptyError ? "Informe seu CPF." : "");
        return false;
      }
      if (!isValidCpf(val)) {
        setFieldError(inputCpf, errCpf, "CPF inválido. Confira os números digitados.");
        return false;
      }
      setFieldError(inputCpf, errCpf, "");
      return true;
    }

    return true;
  }

  inputTelefone.addEventListener("input", function () {
    applyMaskedValue(inputTelefone, formatPhone, normalizeBrPhoneDigits);
    if (inputTelefone.getAttribute("aria-invalid") === "true" && isValidPhone(inputTelefone.value)) {
      setFieldError(inputTelefone, errTelefone, "");
    }
  });

  inputCpf.addEventListener("input", function () {
    applyMaskedValue(inputCpf, formatCpf, function (v) {
      return onlyDigits(v).slice(0, 11);
    });
    if (inputCpf.getAttribute("aria-invalid") === "true" && isValidCpf(inputCpf.value)) {
      setFieldError(inputCpf, errCpf, "");
    }
  });

  inputNome.addEventListener("input", function () {
    if (inputNome.getAttribute("aria-invalid") === "true" && isValidNome(inputNome.value)) {
      setFieldError(inputNome, errNome, "");
    }
  });

  inputEmail.addEventListener("input", function () {
    if (inputEmail.getAttribute("aria-invalid") === "true" && isValidEmail(inputEmail.value)) {
      setFieldError(inputEmail, errEmail, "");
    }
  });

  [inputNome, inputTelefone, inputEmail, inputCpf].forEach(function (el, idx, arr) {
    el.addEventListener("blur", function () {
      if (el.value.trim()) validateField(el, false);
    });

    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && idx < arr.length - 1) {
        e.preventDefault();
        arr[idx + 1].focus();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Envio ao Banco de Dados (Supabase REST API)
  // ---------------------------------------------------------------------------
  async function persistLead(payload) {
    var cfg = window.CAIS_FORM_CONFIG || {};
    var supabaseUrl = String(cfg.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, "");
    var supabaseKey = String(
      cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY
    ).trim();
    var table = String(cfg.SUPABASE_TABLE || DEFAULT_SUPABASE_TABLE).trim();
    var webhookUrl = String(cfg.WEBHOOK_URL || "").trim();

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Configuração do formulário indisponível no momento.");
    }

    var endpoint = supabaseUrl + "/rest/v1/" + encodeURIComponent(table);
    var response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: "Bearer " + supabaseKey,
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });

    var alreadyConfirmed = false;

    if (!response.ok) {
      var errBody = null;
      try {
        errBody = await response.json();
      } catch (_) {}

      if (response.status === 409 || (errBody && errBody.code === "23505")) {
        alreadyConfirmed = true;
      } else {
        throw new Error(
          (errBody && (errBody.message || errBody.details)) ||
            "Erro ao registrar confirmação (" + response.status + ")."
        );
      }
    }

    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    }

    return { alreadyConfirmed: alreadyConfirmed };
  }

  function setSubmitting(loading) {
    submitBtn.disabled = loading;
    submitSpinner.hidden = !loading;
    submitLabel.textContent = loading ? "Confirmando..." : "Confirmar presença";
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    formAlert.hidden = true;
    formAlert.textContent = "";

    var vNome = validateField(inputNome, true);
    var vTel = validateField(inputTelefone, true);
    var vEmail = validateField(inputEmail, true);
    var vCpf = validateField(inputCpf, true);

    if (!vNome || !vTel || !vEmail || !vCpf) {
      var firstInvalid = [inputNome, inputTelefone, inputEmail, inputCpf].find(
        function (el) {
          return el.getAttribute("aria-invalid") === "true";
        }
      );
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    var nomeClean = inputNome.value.trim().replace(/\s+/g, " ");
    var telDigits = normalizeBrPhoneDigits(inputTelefone.value);
    var telFormatted = formatPhone(telDigits);
    var emailClean = inputEmail.value.trim().toLowerCase();
    var cpfDigits = onlyDigits(inputCpf.value).slice(0, 11);
    var cpfFormatted = formatCpf(cpfDigits);

    // Registra a rota sem expor o token secreto na coluna origem_url
    var cleanOriginUrl = window.location.origin + window.location.pathname;

    var payload = {
      nome: nomeClean,
      telefone: telFormatted,
      telefone_numeros: telDigits,
      email: emailClean,
      cpf: cpfFormatted,
      cpf_numeros: cpfDigits,
      origem_url: cleanOriginUrl,
      user_agent: navigator.userAgent || ""
    };

    setSubmitting(true);

    try {
      var result = await persistLead(payload);
      var firstName = nomeClean.split(" ")[0];

      confirmGreeting.innerHTML =
        "Presença confirmada, <em>" + escapeHtml(firstName) + "</em>.";

      if (result.alreadyConfirmed) {
        confirmMessage.textContent =
          "Seu cadastro já constava em nossa lista de convidados. Aguardamos você para a nossa conversa.";
      } else {
        confirmMessage.textContent =
          "Recebemos a sua confirmação. Aguardamos você para uma noite de conversa estratégica sobre proteção e diversificação no exterior.";
      }

      formContainer.hidden = true;
      confirmView.hidden = false;
      confirmView.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      var rawMsg = (err && err.message) || "";
      var friendlyMsg =
        "Não foi possível registrar sua presença agora. Verifique sua conexão e tente novamente.";

      if (
        rawMsg &&
        rawMsg !== "Load failed" &&
        rawMsg !== "Failed to fetch" &&
        !/^NetworkError/i.test(rawMsg)
      ) {
        friendlyMsg = rawMsg;
      }

      formAlert.textContent = friendlyMsg;
      formAlert.hidden = false;
    } finally {
      setSubmitting(false);
    }
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // 5. Geração de arquivo .ics ("Adicionar à agenda" no iOS / Android)
  // ---------------------------------------------------------------------------
  if (calendarBtn) {
    calendarBtn.addEventListener("click", function () {
      var loc = "Enjoy Work Coworking, Alça da Terceira Ponte, 245, Praia da Costa, Vila Velha, ES".replace(/,/g, "\\,");
      var icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Cais Investimentos//Evento Offshore//PT-BR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:evento-offshore-20261112@caisinvestimentos.com.br",
        "DTSTAMP:20261104T190000Z",
        "DTSTART:20261112T220000Z",
        "DTEND:20261113T003000Z",
        "SUMMARY:Encontro Offshore — Cais Investimentos",
        "DESCRIPTION:Encontro fechado da Cais Investimentos sobre cenário macro\\, riscos do momento brasileiro e diversificação patrimonial no exterior.",
        "LOCATION:" + loc,
        "END:VEVENT",
        "END:VCALENDAR"
      ];
      var blob = new Blob([icsLines.join("\r\n")], {
        type: "text/calendar;charset=utf-8"
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "evento-offshore-cais.ics";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
    });
  }
})();
