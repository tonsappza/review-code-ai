const $ = (sel) => document.querySelector(sel);

const THEME_KEY = "rcai-theme";
const appEl = $(".app");
const reportsLayout = $("#reports-layout");
const themeToggle = $("#theme-toggle");
const reportBack = $("#report-back");
const metaThemeColor = $("#meta-theme-color");

const form = $("#review-form");
const runBtn = $("#run-btn");
const loadPrsBtn = $("#load-prs-btn");
const prSelect = $("#pr-select");
const prState = $("#pr-state");
const prHint = $("#pr-hint");
const prPanelManual = $("#pr-panel-manual");
const prPanelLoad = $("#pr-panel-load");
const prNumberManual = $("#pr-number-manual");
const prModeButtons = document.querySelectorAll(".segmented-btn[data-pr-mode]");
const PR_MODE_KEY = "rcai-pr-mode";
const jobPanel = $("#job-panel");
const jobStatus = $("#job-status");
const jobIdEl = $("#job-id");
const jobLog = $("#job-log");
const openReport = $("#open-report");
const statusBar = $("#status-bar");
const reportList = $("#report-list");
const reportView = $("#report-view");
const reportEmpty = $("#report-empty");
const reportTitle = $("#report-title");
const reportVerdict = $("#report-verdict");
const reportPrLink = $("#report-pr-link");
const reportBody = $("#report-body");
const findingsCards = $("#findings-cards");
const severityFilter = $("#severity-filter");
const searchInput = $("#search");

let reports = [];
let eventSource = null;
let currentReportPath = null;

function btnLabel(text) {
  const el = runBtn?.querySelector(".btn-label");
  if (el) el.textContent = text;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  if (metaThemeColor) {
    metaThemeColor.content = theme === "light" ? "#f8fafc" : "#09090b";
  }
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

themeToggle?.addEventListener("click", toggleTheme);

function setMobileTab(tab) {
  if (appEl) appEl.dataset.mobileTab = tab;
  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
});

function setReportDetailOpen(open) {
  reportsLayout?.classList.toggle("detail-open", open);
  reportBack?.classList.toggle("hidden", !open);
}

reportBack?.addEventListener("click", () => {
  setReportDetailOpen(false);
  reportView.classList.add("hidden");
  reportEmpty.classList.remove("hidden");
  currentReportPath = null;
  document.querySelectorAll(".report-item").forEach((b) => b.classList.remove("active"));
});

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setStatusPills(health) {
  statusBar.innerHTML = "";
  const cursor = document.createElement("span");
  cursor.className = "pill " + (health.cursorApiKey ? "ok" : "bad");
  cursor.textContent = health.cursorApiKey ? "CURSOR_API_KEY OK" : "CURSOR_API_KEY missing";
  statusBar.appendChild(cursor);

  const gh = document.createElement("span");
  gh.className = "pill " + (health.githubAuth ? "ok" : "bad");
  gh.textContent = health.githubAuth ? "GitHub OK" : "GitHub auth missing";
  statusBar.appendChild(gh);

  const mode = document.createElement("span");
  mode.className = "pill";
  mode.textContent = "mode: " + (health.defaultReviewMode || "explore");
  statusBar.appendChild(mode);
}

function getPrInputMode() {
  return (
    document.querySelector(".segmented-btn[data-pr-mode].active")?.dataset
      .prMode || "manual"
  );
}

function setPrInputMode(mode) {
  const manual = mode === "manual";
  prModeButtons.forEach((btn) => {
    const on = btn.dataset.prMode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  prPanelManual?.classList.toggle("hidden", !manual);
  prPanelLoad?.classList.toggle("hidden", manual);
  if (prPanelLoad) prPanelLoad.hidden = manual;
  if (prPanelManual) prPanelManual.hidden = !manual;

  if (prNumberManual) {
    prNumberManual.required = manual;
    prNumberManual.disabled = !manual;
  }
  if (prSelect) prSelect.disabled = manual;

  localStorage.setItem(PR_MODE_KEY, mode);

  if (!manual && form.repository.value.trim()) {
    void loadPullRequests();
  }
}

function resolvePrNumber() {
  const mode = getPrInputMode();
  if (mode === "load") {
    const v = prSelect?.value?.trim();
    if (!v) throw new Error("เลือก PR จากรายการ (กดโหลดก่อน)");
    return Number(v);
  }
  const n = Number(prNumberManual?.value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("ใส่เลข PR ที่ถูกต้อง");
  }
  return n;
}

prModeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setPrInputMode(btn.dataset.prMode));
});

function fillDefaults(health) {
  if (health.defaultRepository) {
    form.repository.value = health.defaultRepository;
  }

  const savedMode = localStorage.getItem(PR_MODE_KEY);
  const mode =
    savedMode === "load" || savedMode === "manual" ? savedMode : "manual";
  setPrInputMode(mode);

  if (health.defaultPrNumber && prNumberManual) {
    prNumberManual.value = health.defaultPrNumber;
    if (mode === "load") {
      setPrInputMode("load");
    }
  }

  if (health.defaultReviewMode) {
    form.mode.value = health.defaultReviewMode;
  }
  if (health.model) {
    form.model.placeholder = health.model;
  }
}

function verdictBadge(v) {
  if (!v) return "";
  return `<span class="verdict ${v}">${v}</span>`;
}

function renderReportList(filter = "") {
  const term = filter.trim().toLowerCase();
  const items = reports.filter((r) => {
    if (!term) return true;
    const hay = `${r.owner}/${r.repo} ${r.pr} ${r.title} ${r.verdict || ""}`.toLowerCase();
    return hay.includes(term);
  });

  reportList.innerHTML = "";
  if (!items.length) {
    reportList.innerHTML =
      '<li class="empty-msg">ยังไม่มี report</li>';
    return;
  }

  for (const r of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "report-item";
    if (r.path === currentReportPath) btn.classList.add("active");
    btn.dataset.path = r.path;

    const verdictHtml = r.verdict
      ? `<span class="verdict-mini ${r.verdict}">${r.verdict}</span>`
      : "";
    const counts =
      r.findingCounts &&
      (r.findingCounts.critical || r.findingCounts.major)
        ? `<span class="counts-mini">C${r.findingCounts.critical} · M${r.findingCounts.major}</span>`
        : "";

    btn.innerHTML = `
      <div class="report-item-top">
        <span class="report-item-repo">${escapeHtml(r.owner)}/${escapeHtml(r.repo)}</span>
        <span class="report-item-pr">#${r.pr}</span>
      </div>
      <span class="report-item-title">${escapeHtml(r.title || "—")}</span>
      <div class="report-item-meta">${verdictHtml}${counts}</div>`;

    btn.addEventListener("click", () => loadReport(r.path, btn));
    li.appendChild(btn);
    reportList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderFindingCards(findings) {
  if (!findings?.length) {
    findingsCards.classList.add("hidden");
    findingsCards.innerHTML = "";
    return;
  }
  findingsCards.classList.remove("hidden");
  findingsCards.innerHTML = findings
    .map(
      (f) => `
    <div class="finding-card">
      <span class="sev ${f.severity}">${f.severity}</span>
      <strong>${escapeHtml(f.title)}</strong>
      ${f.file ? `<div class="muted"><code>${escapeHtml(f.file)}</code>${f.line ? `:${f.line}` : ""}</div>` : ""}
      ${f.issue ? `<div>${escapeHtml(f.issue)}</div>` : ""}
    </div>`,
    )
    .join("");
}

async function loadReport(path, activeBtn, severity) {
  currentReportPath = path;
  document.querySelectorAll(".report-item").forEach((b) => {
    b.classList.toggle("active", activeBtn ? b === activeBtn : b.dataset.path === path);
  });

  const q = severity ? `&severity=${severity}` : "";
  const data = await api(`/api/reports/file?path=${encodeURIComponent(path)}${q}`);

  reportEmpty.classList.add("hidden");
  reportView.classList.remove("hidden");
  if (isMobileLayout()) {
    setMobileTab("reports");
    setReportDetailOpen(true);
  } else {
    setReportDetailOpen(false);
  }
  reportTitle.textContent = path;

  const verdict = data.meta?.verdict;
  reportVerdict.innerHTML = verdict ? verdictBadge(verdict) : "";
  if (data.meta?.prUrl) {
    reportPrLink.href = data.meta.prUrl;
    reportPrLink.textContent = "เปิด PR";
  }

  renderFindingCards(data.findings);
  reportBody.innerHTML = marked.parse(data.markdown);
}

severityFilter.addEventListener("change", () => {
  if (!currentReportPath) return;
  const sev = severityFilter.value;
  loadReport(currentReportPath, null, sev || undefined);
});

async function refreshReports() {
  const data = await api("/api/reports");
  reports = data.reports || [];
  renderReportList(searchInput.value);
}

async function loadPullRequests() {
  if (getPrInputMode() !== "load") return;

  const repo = form.repository.value.trim();
  if (!repo) {
    prHint.textContent = "ใส่ repository ก่อน (owner/repo)";
    return;
  }
  loadPrsBtn.disabled = true;
  prHint.textContent = "กำลังโหลด...";
  try {
    const state = prState.value || "all";
    const data = await api(
      `/api/pulls?repository=${encodeURIComponent(repo)}&state=${encodeURIComponent(state)}`,
    );
    prSelect.innerHTML = '<option value="">— เลือก PR —</option>';
    if (!data.pulls?.length) {
      prHint.textContent =
        data.hint ||
        `ไม่มี PR (state=${state}) — รีสตาร์ท UI (Ctrl+C แล้ว npm run ui) หรือใส่เลข PR เอง`;
      return;
    }
    for (const pr of data.pulls) {
      const opt = document.createElement("option");
      opt.value = String(pr.number);
      const tag = pr.merged ? " [merged]" : pr.state === "open" ? "" : " [closed]";
      opt.textContent = `#${pr.number}${tag} ${pr.title}`;
      prSelect.appendChild(opt);
    }
    prHint.textContent = `พบ ${data.pulls.length} PR${data.source ? ` (${data.source})` : ""}`;
    if (prNumberManual?.value) {
      const match = [...prSelect.options].find(
        (o) => o.value === prNumberManual.value,
      );
      if (match) prSelect.value = match.value;
    }
  } catch (err) {
    prHint.textContent = "";
    alert(err.message);
  } finally {
    loadPrsBtn.disabled = false;
  }
}

loadPrsBtn.addEventListener("click", () => void loadPullRequests());

prSelect.addEventListener("change", () => {
  if (prSelect.value && prHint) {
    prHint.textContent = `เลือก PR #${prSelect.value}`;
  }
});

function applyJobStatus(status, verdict, reportPath) {
  jobStatus.textContent = status + (verdict ? ` · ${verdict}` : "");
  jobStatus.className = "status-chip " + status;
  if (status === "done" && reportPath) {
    runBtn.disabled = false;
    btnLabel("เริ่ม Review");
    openReport.classList.remove("hidden");
    openReport.onclick = (e) => {
      e.preventDefault();
      setMobileTab("reports");
      void loadReport(reportPath);
    };
    openReport.textContent = "ดู report: " + reportPath;
    void refreshReports();
  }
  if (status === "error") {
    runBtn.disabled = false;
    btnLabel("เริ่ม Review");
    openReport.classList.add("hidden");
  }
}

function streamJob(id) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource(`/api/jobs/${id}/stream`);
  jobLog.textContent = "";

  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "log") {
      jobLog.textContent += (jobLog.textContent ? "\n" : "") + data.line;
      jobLog.scrollTop = jobLog.scrollHeight;
    }
    if (data.type === "status") {
      applyJobStatus(data.status, data.verdict, data.reportPath);
      if (data.status === "done" || data.status === "error") {
        eventSource?.close();
        eventSource = null;
      }
    }
  };

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    void api(`/api/jobs/${id}`).then((job) => {
      jobLog.textContent = job.logs.join("\n");
      applyJobStatus(job.status, job.verdict, job.reportPath);
    });
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  let prNumber;
  try {
    prNumber = resolvePrNumber();
  } catch (err) {
    alert(err.message);
    return;
  }

  runBtn.disabled = true;
  jobPanel.classList.remove("hidden");
  jobLog.textContent = "Starting...";
  openReport.classList.add("hidden");

  const body = {
    repository: form.repository.value.trim(),
    prNumber,
    postPrLink: form.postPrLink.checked,
    postInline: form.postInline.checked,
    incremental: form.incremental.checked,
    model: form.model.value.trim() || undefined,
    mode: form.mode.value,
  };

  try {
    const { jobId } = await api("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    jobIdEl.textContent = jobId;
    jobStatus.textContent = "queued";
    jobStatus.className = "status-chip running";
    btnLabel("กำลัง review…");

    streamJob(jobId);
  } catch (err) {
    runBtn.disabled = false;
    btnLabel("เริ่ม Review");
    jobStatus.textContent = "error";
    jobStatus.className = "status-chip error";
    jobLog.textContent = err.message;
  }
});

searchInput.addEventListener("input", () => renderReportList(searchInput.value));

async function init() {
  setTheme(getTheme());
  setMobileTab("review");
  if (!localStorage.getItem(PR_MODE_KEY)) {
    setPrInputMode("manual");
  }
  if (metaThemeColor) {
    metaThemeColor.content = getTheme() === "light" ? "#f8fafc" : "#09090b";
  }

  try {
    const health = await api("/api/health");
    setStatusPills(health);
    fillDefaults(health);
  } catch (err) {
    statusBar.innerHTML = `<span class="pill bad">Server: ${escapeHtml(err.message)}</span>`;
  }
  await refreshReports();
}

init();
