const $ = (sel) => document.querySelector(sel);

const THEME_KEY = "rcai-theme";
const appEl = $(".app");
const reportsLayout = $("#reports-layout");
const themeToggle = $("#theme-toggle");
const reportBack = $("#report-back");
const metaThemeColor = $("#meta-theme-color");

const form = $("#review-form");
const repoCombo = $("#repo-combo");
const repoComboTrigger = $("#repo-combo-trigger");
const repoComboLabelText = $("#repo-combo-label-text");
const repoComboMenu = $("#repo-combo-menu");
const repoComboList = $("#repo-combo-list");
const repoSearch = $("#repo-search");
const repoValue = $("#repo-value");
const repoInputManual = $("#repo-input-manual");
const repoHint = $("#repo-hint");
const loadReposBtn = $("#load-repos-btn");
const repoPanelGithub = $("#repo-panel-github");
const repoPanelManual = $("#repo-panel-manual");
const severityFilterWrap = $("#severity-filter-wrap");
const LOAD_REPOS_BTN_LABEL = "โหลด repo จาก GitHub";
const repoModeButtons = document.querySelectorAll(
  ".repo-field .segmented-btn[data-repo-mode]",
);
const REPO_MODE_KEY = "rcai-repo-mode";
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
let serverApiVersion = 0;
/** @type {Array<{ fullName: string; description: string | null; private: boolean }>} */
let cachedRepos = [];

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

function getRepoInputMode() {
  return (
    document.querySelector(".repo-field .segmented-btn[data-repo-mode].active")
      ?.dataset.repoMode || "github"
  );
}

function setComboTriggerText(text, sub = "") {
  if (!repoComboLabelText) return;
  if (sub) {
    repoComboLabelText.innerHTML = `<span class="combo-primary">${escapeHtml(text)}</span><span class="combo-sub">${escapeHtml(sub)}</span>`;
  } else {
    repoComboLabelText.textContent = text;
  }
}

function setRepositoryValue(fullName) {
  if (repoValue) repoValue.value = fullName;
  const repo = cachedRepos.find((r) => r.fullName === fullName);
  if (fullName && repo) {
    setComboTriggerText(repo.fullName, repo.private ? "private" : repo.description?.slice(0, 40) ?? "");
  } else if (fullName) {
    setComboTriggerText(fullName);
  } else {
    setComboTriggerText(cachedRepos.length ? "เลือก repository" : "กดโหลด repo ก่อน");
  }
}

function setRepoComboOpen(open) {
  if (!repoCombo || !repoComboTrigger || !repoComboMenu) return;
  repoCombo.classList.toggle("is-open", open);
  repoComboTrigger.setAttribute("aria-expanded", open ? "true" : "false");
  repoComboMenu.classList.toggle("hidden", !open);
  if (open) {
    repoSearch?.focus();
  }
}

function setRepoComboEnabled(enabled) {
  if (repoComboTrigger) repoComboTrigger.disabled = !enabled;
  if (repoSearch) repoSearch.disabled = !enabled;
}

function getRepository() {
  const mode = getRepoInputMode();
  if (mode === "manual") {
    const v = repoInputManual?.value?.trim() ?? "";
    if (!v.includes("/")) {
      throw new Error("ใส่ repository แบบ owner/repo");
    }
    return v;
  }
  const v = (repoValue?.value || "").trim();
  if (!v) {
    throw new Error("เลือก repository จาก GitHub (กดโหลดก่อน)");
  }
  return v;
}

function setRepoInputMode(
  mode,
  options = { autoLoad: true, silent: true },
) {
  const github = mode === "github";
  repoModeButtons.forEach((btn) => {
    const on = btn.dataset.repoMode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  repoPanelGithub?.classList.toggle("hidden", !github);
  repoPanelManual?.classList.toggle("hidden", github);
  if (repoPanelGithub) repoPanelGithub.hidden = !github;
  if (repoPanelManual) repoPanelManual.hidden = github;

  if (repoInputManual) repoInputManual.required = !github;
  if (!github) setRepoComboOpen(false);
  setRepoComboEnabled(github && cachedRepos.length > 0);

  localStorage.setItem(REPO_MODE_KEY, mode);

  if (github && options.autoLoad) void loadRepositories({ silent: options.silent });
  else if (github && options.autoLoad && serverApiVersion < 2) {
    repoHint.textContent = "รีสตาร์ท UI: Ctrl+C แล้ว npm run ui";
  }
}

repoModeButtons.forEach((btn) => {
  btn.addEventListener("click", () =>
    setRepoInputMode(btn.dataset.repoMode, { autoLoad: true, silent: false }),
  );
});

function repoApiErrorMessage(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "Not Found") {
    return "เซิร์ฟเวอร์เก่า — รีสตาร์ท: Ctrl+C แล้ว npm run ui";
  }
  return msg;
}

function groupReposByOwner(repos) {
  const map = new Map();
  for (const r of repos) {
    const slash = r.fullName.indexOf("/");
    const owner = slash > 0 ? r.fullName.slice(0, slash) : r.fullName;
    const repoName = slash > 0 ? r.fullName.slice(slash + 1) : r.fullName;
    if (!map.has(owner)) map.set(owner, []);
    map.get(owner).push({ ...r, repoName });
  }
  return [...map.entries()].sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function renderRepoCombo(filter = "", selected = "") {
  if (!repoComboList) return;

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? cachedRepos.filter((r) => {
        const hay = `${r.fullName} ${r.description ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
    : cachedRepos;

  if (filtered.length === 0) {
    repoComboList.innerHTML = `<div class="combo-empty">${q ? "ไม่พบ repository" : "ไม่มี repo"}</div>`;
    return;
  }

  const parts = [];
  for (const [owner, list] of groupReposByOwner(filtered)) {
    parts.push(`<div class="combo-group-label">${escapeHtml(owner)}</div>`);
    for (const r of list) {
      const active = r.fullName === selected ? " is-active" : "";
      const lock = r.private
        ? '<span class="combo-badge">private</span>'
        : "";
      const desc = r.description
        ? `<span class="combo-option-desc">${escapeHtml(r.description.slice(0, 48))}${r.description.length > 48 ? "…" : ""}</span>`
        : "";
      parts.push(
        `<button type="button" class="combo-option${active}" role="option" data-value="${escapeHtml(r.fullName)}" aria-selected="${r.fullName === selected}">` +
          `<span class="combo-option-main"><span class="combo-option-name">${escapeHtml(r.repoName)}</span>${lock}</span>` +
          desc +
          `</button>`,
      );
    }
  }
  repoComboList.innerHTML = parts.join("");

  repoComboList.querySelectorAll(".combo-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;
      if (!value) return;
      setRepositoryValue(value);
      renderRepoCombo(repoSearch?.value ?? "", value);
      setRepoComboOpen(false);
      if (getPrInputMode() === "load") void loadPullRequests();
    });
  });
}

function setRepoLoading(loading) {
  repoPanelGithub?.classList.toggle("is-loading", loading);

  if (loadReposBtn) {
    loadReposBtn.disabled = loading;
    loadReposBtn.textContent = loading ? "กำลังโหลด…" : LOAD_REPOS_BTN_LABEL;
  }

  if (loading) {
    if (repoHint) {
      repoHint.classList.add("is-loading");
      repoHint.innerHTML =
        '<span class="loading-row"><span class="spinner" aria-hidden="true"></span>โหลดรอก่อน…</span>';
    }
    setComboTriggerText("โหลดรอก่อน…");
    setRepoComboEnabled(false);
    setRepoComboOpen(false);
    if (repoSearch) repoSearch.placeholder = "โหลดรอก่อน…";
    if (repoComboList) {
      repoComboList.innerHTML =
        '<div class="combo-empty"><span class="spinner" aria-hidden="true"></span> โหลดรอก่อน…</div>';
    }
    return;
  }

  repoHint?.classList.remove("is-loading");
}

async function loadRepositories(options = { silent: false }) {
  if (getRepoInputMode() !== "github") return;

  if (serverApiVersion < 2) {
    repoHint.textContent = "รีสตาร์ท UI: Ctrl+C แล้ว npm run ui";
    if (!options.silent) {
      alert(repoHint.textContent);
    }
    return;
  }

  setRepoLoading(true);
  try {
    const data = await api("/api/repos?limit=100");
    const user = await api("/api/github/me").catch(() => null);

    cachedRepos = data.repos ?? [];
    const prev = repoValue?.value || "";

    if (repoSearch) {
      repoSearch.value = "";
      repoSearch.placeholder = "ค้นหา owner / repo…";
    }
    setRepoComboEnabled(true);

    renderRepoCombo("", prev);
    if (prev) setRepositoryValue(prev);
    else setComboTriggerText("เลือก repository");

    const owners = new Set(
      cachedRepos.map((r) => r.fullName.split("/")[0]).filter(Boolean),
    );
    const who = user?.login ? `@${user.login}` : "GitHub";
    if (repoHint) {
      repoHint.textContent = `${who} · ${cachedRepos.length} repo · ${owners.size} owner${data.source ? ` (${data.source})` : ""}`;
    }
  } catch (err) {
    const msg = repoApiErrorMessage(err);
    if (repoHint) repoHint.textContent = msg;
    if (cachedRepos.length === 0) {
      setRepoComboEnabled(false);
      setComboTriggerText("กดโหลด repo ก่อน");
      if (repoComboList) {
        repoComboList.innerHTML =
          '<div class="combo-empty">กดโหลด repo จาก GitHub</div>';
      }
    }
    if (!options.silent) alert(msg);
  } finally {
    setRepoLoading(false);
  }
}

loadReposBtn?.addEventListener("click", () =>
  void loadRepositories({ silent: false }),
);

repoComboTrigger?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (repoComboTrigger.disabled || cachedRepos.length === 0) return;
  const open = !repoCombo?.classList.contains("is-open");
  setRepoComboOpen(open);
  if (open) {
    renderRepoCombo(repoSearch?.value ?? "", repoValue?.value ?? "");
  }
});

repoComboMenu?.addEventListener("click", (e) => e.stopPropagation());

repoSearch?.addEventListener("input", () => {
  renderRepoCombo(repoSearch.value, repoValue?.value ?? "");
});

repoSearch?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setRepoComboOpen(false);
});

document.addEventListener("click", (e) => {
  if (!repoCombo?.contains(e.target)) setRepoComboOpen(false);
});

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

  if (!manual) {
    try {
      getRepository();
      void loadPullRequests();
    } catch {
      /* repo not chosen yet */
    }
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
  const savedRepoMode = localStorage.getItem(REPO_MODE_KEY);
  const repoMode =
    savedRepoMode === "manual" || savedRepoMode === "github"
      ? savedRepoMode
      : "github";
  setRepoInputMode(repoMode, { autoLoad: false, silent: true });

  if (health.defaultRepository) {
    if (repoMode === "github") {
      setRepositoryValue(health.defaultRepository);
    } else if (repoInputManual) {
      repoInputManual.value = health.defaultRepository;
    }
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

function reportHasFindings(data) {
  if (data.findings?.length) return true;
  const c = data.counts ?? data.meta?.findingCounts;
  if (!c || typeof c !== "object") return false;
  return (
    (c.critical ?? 0) +
      (c.major ?? 0) +
      (c.minor ?? 0) +
      (c.suggestion ?? 0) >
    0
  );
}

function updateFindingsFilterVisibility(data) {
  const show = reportHasFindings(data);
  severityFilterWrap?.classList.toggle("hidden", !show);
  if (!show && severityFilter) severityFilter.value = "";
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

  updateFindingsFilterVisibility(data);
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

  let repo;
  try {
    repo = getRepository();
  } catch {
    prHint.textContent = "เลือก repository ก่อน";
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

  let repository;
  let prNumber;
  try {
    repository = getRepository();
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
    repository,
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
  if (metaThemeColor) {
    metaThemeColor.content = getTheme() === "light" ? "#f8fafc" : "#09090b";
  }

  try {
    const health = await api("/api/health");
    serverApiVersion = health.apiVersion ?? 0;
    setStatusPills(health);

    if (!localStorage.getItem(PR_MODE_KEY)) {
      setPrInputMode("manual");
    }

    fillDefaults(health);

    if (getRepoInputMode() === "github" && health.githubAuth) {
      const shouldLoad =
        serverApiVersion >= 2 || cachedRepos.length === 0;
      if (shouldLoad) {
        void loadRepositories({ silent: true });
      }
    }
  } catch (err) {
    statusBar.innerHTML = `<span class="pill bad">Server: ${escapeHtml(err.message)}</span>`;
  }

  await refreshReports();
}

init();
