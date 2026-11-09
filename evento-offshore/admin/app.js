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

    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!records || records.length === 0) {
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    records.forEach(function (item, index) {
      var tr = document.createElement("tr");

      var rawPhoneDigits = String(item.telefone_numeros || item.telefone || "").replace(/\D+/g, "");
      var waUrl = rawPhoneDigits
        ? "https://wa.me/55" + rawPhoneDigits
        : "#";

      tr.innerHTML =
        "<td>" + (index + 1) + "</td>" +
        "<td><strong class=\"table-user-name\">" + escapeHtml(item.nome) + "</strong></td>" +
        "<td>" +
          (rawPhoneDigits
            ? "<a class=\"table-link\" href=\"" + waUrl + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Abrir no WhatsApp\">" +
                escapeHtml(item.telefone) +
                "<span class=\"wa-badge\">↗ WA</span>" +
              "</a>"
            : escapeHtml(item.telefone)) +
        "</td>" +
        "<td><a class=\"table-link\" href=\"mailto:" + escapeHtml(item.email) + "\">" + escapeHtml(item.email) + "</a></td>" +
        "<td>" + escapeHtml(item.cpf || "-") + "</td>" +
        "<td>" + formatDate(item.created_at) + "</td>" +
        "<td>" +
          "<button type=\"button\" class=\"btn-delete\" data-id=\"" + item.id + "\" data-nome=\"" + escapeHtml(item.nome) + "\">" +
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
    var filtered = allRecords.filter(function (r) {
      var nome = String(r.nome || "").toLowerCase();
      var email = String(r.email || "").toLowerCase();
      var tel = String(r.telefone || "").toLowerCase();
      var cpf = String(r.cpf || "").toLowerCase();
      var telNum = String(r.telefone_numeros || "");
      var cpfNum = String(r.cpf_numeros || "");

      return (
        nome.indexOf(term) !== -1 ||
        email.indexOf(term) !== -1 ||
        tel.indexOf(term) !== -1 ||
        cpf.indexOf(term) !== -1 ||
        (cleanDigits && (telNum.indexOf(cleanDigits) !== -1 || cpfNum.indexOf(cleanDigits) !== -1))
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

    try {
      var res = await callRpc("admin_list_confirmacoes", { p_token: token });
      if (!res.ok) {
        throw new Error(res.error || "Sessão expirada.");
      }

      allRecords = res.data || [];
      filterRecords();
      showDashboard();
    } catch (err) {
      clearSession();
      showLogin(err.message || "Sua sessão expirou. Faça login novamente.");
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
        var res = await callRpc("admin_delete_confirmacao", {
          p_token: token,
          p_id: pendingDeleteId
        });

        if (!res.ok) {
          throw new Error(res.error || "Erro ao excluir registro.");
        }

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

    var headers = ["Nome Completo", "Telefone / WhatsApp", "E-mail", "CPF", "Data de Confirmação"];
    var rows = [headers];

    dataToExport.forEach(function (item) {
      rows.push([
        item.nome || "",
        item.telefone || "",
        item.email || "",
        item.cpf || "",
        formatDate(item.created_at)
      ]);
    });

    var csvContent = "\uFEFF"; // UTF-8 BOM para abrir com acentuação correta no Excel Brasil
    rows.forEach(function (row) {
      var line = row
        .map(function (val) {
          var clean = String(val).replace(/"/g, '""');
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
    a.download = "confirmacoes-evento-offshore-" + nowStr + ".csv";
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
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", function () {
      window.print();
    });
  }

  // Inicialização
  if (getSessionToken()) {
    loadData();
  } else {
    showLogin();
  }
})();
