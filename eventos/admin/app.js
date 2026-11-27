(function () {
  "use strict";

  var SUPABASE_URL = "https://laukfwrsdvchozgicjxm.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdWtmd3JzZHZjaG96Z2ljanhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTc0MDEsImV4cCI6MjEwOTM5MzQwMX0.YL1UZkZlPFjWlpJkMUZjW-y7xU4c-D1KXYtQIiFkzMo";

  var STORAGE_TOKEN_KEY = "cais_admin_session_token";
  var STORAGE_USER_KEY = "cais_admin_username";

  // Elements
  var loginView = document.getElementById("login-view");
  var dashboardView = document.getElementById("dashboard-view");
  var loginForm = document.getElementById("login-form");
  var loginUser = document.getElementById("login-username");
  var loginPass = document.getElementById("login-password");
  var loginAlert = document.getElementById("login-alert");
  var loginBtn = document.getElementById("login-submit-btn");

  var userDisplay = document.getElementById("current-user-display");
  var logoutBtn = document.getElementById("logout-btn");
  var refreshBtn = document.getElementById("refresh-btn");
  var searchInput = document.getElementById("search-input");
  var totalCountEl = document.getElementById("total-count");
  var tableBody = document.getElementById("table-body");
  var emptyState = document.getElementById("empty-state");

  var exportCsvBtn = document.getElementById("export-csv-btn");
  var exportPdfBtn = document.getElementById("export-pdf-btn");

  var deleteModal = document.getElementById("delete-modal");
  var deleteGuestName = document.getElementById("delete-guest-name");
  var deleteCancelBtn = document.getElementById("delete-cancel-btn");
  var deleteConfirmBtn = document.getElementById("delete-confirm-btn");

  // State
  var allRecords = [];
  var filteredRecords = [];
  var pendingDeleteId = null;
  var currentTab = "offshore";

  function waLink(e164OrDigits, label) {
    var digits = String(e164OrDigits || "").replace(/\D+/g, "");
    if (!digits) return escapeHtml(label || "-");
    if (digits.length <= 11) digits = "55" + digits;
    return (
      "<a class=\"table-link\" href=\"https://wa.me/" + digits + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Abrir no WhatsApp\">" +
      escapeHtml(label) +
      "<span class=\"wa-badge\">↗ WA</span>" +
      "</a>"
    );
  }

  function mailLink(email) {
    if (!email) return "-";
    return "<a class=\"table-link\" href=\"mailto:" + escapeHtml(email) + "\">" + escapeHtml(email) + "</a>";
  }

  // +5527999998888 -> (27) 99999-8888
  function formatPhone(e164) {
    var d = String(e164 || "").replace(/\D+/g, "");
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return e164 || "";
  }

  async function callGymclub(method, path) {
    var res = await fetch("/gymclub/api/admin/cadastros" + (path || ""), {
      method: method,
      headers: { Authorization: "Bearer " + getSessionToken() }
    });
    if (res.status === 401) throw new Error("Sua sessão expirou. Faça login novamente.");
    if (!res.ok) throw new Error("Erro na comunicação com o servidor (" + res.status + ").");
    return await res.json();
  }

  // Cada aba: de onde vêm os dados, colunas (tela, CSV e PDF) e textos.
  var TABS = {
    offshore: {
      subtitle: "Evento Offshore · Cais Investimentos",
      statLabel: "Total de Convidados Confirmados",
      printLabel: "convidados confirmados",
      searchPlaceholder: "Buscar por nome, e-mail, telefone ou CPF...",
      emptyText: "Nenhuma confirmação encontrada.",
      deleteWhat: "a confirmação",
      csvName: "confirmacoes-evento-offshore",
      load: async function (token) {
        var res = await callRpc("admin_list_confirmacoes", { p_token: token });
        if (!res.ok) {
          var err = new Error(res.error || "Sessão expirada.");
          err.sessao = true;
          throw err;
        }
        return res.data || [];
      },
      remove: async function (token, id) {
        var res = await callRpc("admin_delete_confirmacao", { p_token: token, p_id: id });
        if (!res.ok) throw new Error(res.error || "Erro ao excluir registro.");
      },
      searchText: function (r) {
        return [r.nome, r.email, r.telefone, r.cpf].join(" ");
      },
      searchDigits: function (r) {
        return String(r.telefone_numeros || "") + " " + String(r.cpf_numeros || "");
      },
      columns: [
        { title: "Nome Completo", text: function (r) { return r.nome || ""; }, html: function (r) { return "<strong class=\"table-user-name\">" + escapeHtml(r.nome) + "</strong>"; } },
        { title: "Telefone / WhatsApp", text: function (r) { return r.telefone || ""; }, html: function (r) { return waLink(r.telefone_numeros || r.telefone, r.telefone); } },
        { title: "E-mail", text: function (r) { return r.email || ""; }, html: function (r) { return mailLink(r.email); } },
        { title: "CPF", text: function (r) { return r.cpf || ""; }, html: function (r) { return escapeHtml(r.cpf || "-"); } },
        { title: "Data de Confirmação", text: function (r) { return formatDate(r.created_at); } }
      ]
    },
    gymclub: {
      subtitle: "Captação na Gym Club · Cais Investimentos",
      statLabel: "Total de Cadastros na Gym Club",
      printLabel: "cadastros",
      searchPlaceholder: "Buscar por nome, telefone, e-mail, observação ou colaborador...",
      emptyText: "Nenhum cadastro encontrado.",
      deleteWhat: "o cadastro",
      csvName: "cadastros-gym-club",
      load: async function () {
        return (await callGymclub("GET")).cadastros || [];
      },
      remove: async function (_token, id) {
        await callGymclub("DELETE", "/" + encodeURIComponent(id));
      },
      searchText: function (r) {
        return [r.nome, r.email, r.telefone, formatPhone(r.telefone), r.observacoes, r.colaborador].join(" ");
      },
      searchDigits: function (r) {
        return String(r.telefone || "").replace(/\D+/g, "");
      },
      columns: [
        { title: "Nome", text: function (r) { return r.nome || ""; }, html: function (r) { return "<strong class=\"table-user-name\">" + escapeHtml(r.nome) + "</strong>"; } },
        { title: "WhatsApp", text: function (r) { return formatPhone(r.telefone); }, html: function (r) { return r.telefone ? waLink(r.telefone, formatPhone(r.telefone)) : "-"; } },
        { title: "E-mail", text: function (r) { return r.email || ""; }, html: function (r) { return mailLink(r.email); } },
        { title: "Observações", text: function (r) { return r.observacoes || ""; }, html: function (r) { return r.observacoes ? "<span class=\"table-note\">" + escapeHtml(r.observacoes) + "</span>" : "-"; } },
        { title: "Cadastrado por", text: function (r) { return r.colaborador || ""; } },
        { title: "Data do Cadastro", text: function (r) { return formatDate(r.criado_em || r.recebido_em); } }
      ]
    }
  };

  function applyTab() {
    var tab = TABS[currentTab];
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("nav-subtitle", tab.subtitle);
    set("stat-label", tab.statLabel);
    set("print-total-label", tab.printLabel);
    set("empty-text", tab.emptyText);
    set("delete-what", tab.deleteWhat);
    if (searchInput) {
      searchInput.placeholder = tab.searchPlaceholder;
      searchInput.value = "";
    }
    var table = document.getElementById("data-table");
    if (table) table.className = "data-table data-table--" + currentTab;
    var head = document.getElementById("table-head");
    if (head) {
      head.innerHTML =
        "<th style=\"width: 44px;\">#</th>" +
        tab.columns.map(function (c) { return "<th>" + escapeHtml(c.title) + "</th>"; }).join("") +
        "<th style=\"width: 90px; text-align: center;\">Ações</th>";
    }
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (btn) {
      var active = btn.getAttribute("data-tab") === currentTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (btn) {
    btn.addEventListener("click", function () {
      var next = btn.getAttribute("data-tab");
      if (next === currentTab || !TABS[next]) return;
      currentTab = next;
      allRecords = [];
      applyTab();
      renderTable([]);
      loadData();
    });
  });

  async function callRpc(fnName, params) {
    var res = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fnName, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(params || {})
    });

    if (!res.ok) {
      var err = null;
      try {
        err = await res.json();
      } catch (_) {}
      throw new Error(
        (err && (err.message || err.details)) ||
          "Erro na comunicação com o servidor (" + res.status + ")."
      );
    }

    return await res.json();
  }

  function getSessionToken() {
    try {
      return (
        sessionStorage.getItem(STORAGE_TOKEN_KEY) ||
        localStorage.getItem(STORAGE_TOKEN_KEY) ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  function saveSession(token, username) {
    try {
      sessionStorage.setItem(STORAGE_TOKEN_KEY, token);
      sessionStorage.setItem(STORAGE_USER_KEY, username);
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
      localStorage.setItem(STORAGE_USER_KEY, username);
    } catch (_) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_TOKEN_KEY);
      sessionStorage.removeItem(STORAGE_USER_KEY);
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
    } catch (_) {}
  }

  function formatDate(isoStr) {
    if (!isoStr) return "-";
    try {
      var d = new Date(isoStr);
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_) {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTable(records) {
    filteredRecords = records;
    if (totalCountEl) totalCountEl.textContent = allRecords.length;
    var printTotalEl = document.getElementById("print-total-count");
    if (printTotalEl) printTotalEl.textContent = records.length;

    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!records || records.length === 0) {
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    var columns = TABS[currentTab].columns;
    records.forEach(function (item, index) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (index + 1) + "</td>" +
        columns
          .map(function (c) {
            return "<td>" + (c.html ? c.html(item) : escapeHtml(c.text(item) || "-")) + "</td>";
          })
          .join("") +
        "<td>" +
          "<button type=\"button\" class=\"btn-delete\" data-id=\"" + escapeHtml(item.id) + "\" data-nome=\"" + escapeHtml(item.nome) + "\">" +
            "Excluir" +
          "</button>" +
        "</td>";

      tableBody.appendChild(tr);
    });
  }

  function filterRecords() {
    var term = String((searchInput && searchInput.value) || "").trim().toLowerCase();
    if (!term) {
      renderTable(allRecords);
      return;
    }

    var cleanDigits = term.replace(/\D+/g, "");
    var tab = TABS[currentTab];
    var filtered = allRecords.filter(function (r) {
      return (
        tab.searchText(r).toLowerCase().indexOf(term) !== -1 ||
        (cleanDigits && tab.searchDigits(r).indexOf(cleanDigits) !== -1)
      );
    });

    renderTable(filtered);
  }

  async function loadData() {
    var token = getSessionToken();
    if (!token) {
      showLogin();
      return;
    }

    if (refreshBtn) refreshBtn.disabled = true;

    var tabAtLoad = currentTab;
    try {
      var data = await TABS[tabAtLoad].load(token);
      if (tabAtLoad !== currentTab) return; // trocou de aba enquanto carregava
      allRecords = data;
      filterRecords();
      showDashboard();
    } catch (err) {
      if (tabAtLoad !== currentTab) return;
      if (tabAtLoad === "offshore" || /sess[ãa]o/i.test(err.message || "")) {
        clearSession();
        showLogin(err.message || "Sua sessão expirou. Faça login novamente.");
      } else {
        // Falha só da lista da Gym Club: mantém o login e avisa.
        allRecords = [];
        renderTable([]);
        showDashboard();
        alert("Não foi possível carregar os cadastros da Gym Club: " + (err.message || "erro inesperado"));
      }
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function showLogin(msg) {
    if (loginAlert) {
      if (msg) {
        loginAlert.textContent = msg;
        loginAlert.hidden = false;
      } else {
        loginAlert.hidden = true;
      }
    }
    if (dashboardView) dashboardView.hidden = true;
    if (loginView) loginView.hidden = false;
  }

  function showDashboard() {
    var username = sessionStorage.getItem(STORAGE_USER_KEY) || localStorage.getItem(STORAGE_USER_KEY) || "admin";
    if (userDisplay) userDisplay.textContent = username;

    if (loginView) loginView.hidden = true;
    if (dashboardView) dashboardView.hidden = false;
  }

  // Login Submit
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      loginAlert.hidden = true;
      loginAlert.textContent = "";

      var u = (loginUser && loginUser.value || "").trim();
      var p = (loginPass && loginPass.value || "").trim();

      if (!u || !p) {
        loginAlert.textContent = "Preencha usuário e senha.";
        loginAlert.hidden = false;
        return;
      }

      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = "Entrando...";
      }

      try {
        var res = await callRpc("admin_login", {
          p_username: u,
          p_password: p
        });

        if (!res.ok) {
          throw new Error(res.error || "Usuário ou senha incorretos.");
        }

        saveSession(res.token, res.username || u);
        await loadData();
      } catch (err) {
        loginAlert.textContent = err.message || "Erro ao efetuar login.";
        loginAlert.hidden = false;
      } finally {
        if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.textContent = "Entrar no painel";
        }
      }
    });
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      clearSession();
      allRecords = [];
      filteredRecords = [];
      if (loginPass) loginPass.value = "";
      showLogin();
    });
  }

  // Refresh
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      loadData();
    });
  }

  // Search
  if (searchInput) {
    searchInput.addEventListener("input", filterRecords);
  }

  // Delete Action via Event Delegation
  if (tableBody) {
    tableBody.addEventListener("click", function (e) {
      var btn = e.target.closest(".btn-delete");
      if (!btn) return;

      var id = btn.getAttribute("data-id");
      var nome = btn.getAttribute("data-nome") || "este convidado";

      pendingDeleteId = id;
      if (deleteGuestName) deleteGuestName.textContent = nome;
      if (deleteModal) deleteModal.hidden = false;
    });
  }

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener("click", function () {
      pendingDeleteId = null;
      if (deleteModal) deleteModal.hidden = true;
    });
  }

  if (deleteModal) {
    deleteModal.addEventListener("click", function (e) {
      if (e.target === deleteModal) {
        pendingDeleteId = null;
        deleteModal.hidden = true;
      }
    });
  }

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && deleteModal && !deleteModal.hidden) {
      pendingDeleteId = null;
      deleteModal.hidden = true;
    }
  });

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener("click", async function () {
      if (!pendingDeleteId) return;

      var token = getSessionToken();
      if (!token) {
        showLogin();
        return;
      }

      deleteConfirmBtn.disabled = true;
      deleteConfirmBtn.textContent = "Excluindo...";

      try {
        await TABS[currentTab].remove(token, pendingDeleteId);

        if (deleteModal) deleteModal.hidden = true;
        pendingDeleteId = null;
        await loadData();
      } catch (err) {
        alert("Não foi possível excluir: " + (err.message || "erro inesperado"));
      } finally {
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = "Confirmar Exclusão";
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Exportar para Excel (.CSV com padrão PT-BR: ponto-e-vírgula e UTF-8 BOM)
  // ---------------------------------------------------------------------------
  function exportCsv() {
    var dataToExport = filteredRecords && filteredRecords.length ? filteredRecords : allRecords;
    if (!dataToExport || !dataToExport.length) {
      alert("Nenhum registro para exportar.");
      return;
    }

    var columns = TABS[currentTab].columns;
    var rows = [columns.map(function (c) { return c.title; })];

    dataToExport.forEach(function (item) {
      rows.push(columns.map(function (c) { return c.text(item); }));
    });

    var csvContent = "\uFEFF"; // UTF-8 BOM para abrir com acentuação correta no Excel Brasil
    rows.forEach(function (row) {
      var line = row
        .map(function (val) {
          var clean = String(val == null ? "" : val).replace(/"/g, '""');
          // Texto digitado por terceiros não pode virar fórmula ao abrir no Excel.
          if (/^[=+\-@\t\r]/.test(clean)) clean = "'" + clean;
          return '"' + clean + '"';
        })
        .join(";");
      csvContent += line + "\r\n";
    });

    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var nowStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = TABS[currentTab].csvName + "-" + nowStr + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", exportCsv);
  }

  // ---------------------------------------------------------------------------
  // Exportar para PDF (Gera visualização de impressão A4 corporativa da Cais)
  // ---------------------------------------------------------------------------
  function updatePrintTimestamp() {
    var tsEl = document.getElementById("print-timestamp");
    if (tsEl) {
      var d = new Date();
      tsEl.textContent =
        "Emitido em " +
        d.toLocaleDateString("pt-BR") +
        " às " +
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
  }

  window.addEventListener("beforeprint", updatePrintTimestamp);

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", function () {
      updatePrintTimestamp();
      window.print();
    });
  }

  // Inicialização
  applyTab();
  if (getSessionToken()) {
    loadData();
  } else {
    showLogin();
  }
})();
