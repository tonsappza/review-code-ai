const $ = (sel) => document.querySelector(sel);

const form = $("#review-form");
const runBtn = $("#run-btn");
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
const reportPrLink = $("#report-pr-link");
const reportBody = $("#report-body");
const searchInput = $("#search");

let reports = [];
let pollTimer = null;

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
  cursor.textContent = health.cursorApiKey ? "CURSOR_API_KEY ✓" : "CURSOR_API_KEY ✗";
  statusBar.appendChild(cursor);

  const gh = document.createElement("span");
  gh.className = "pill " + (health.githubAuth ? "ok" : "bad");
  gh.textContent = health.githubAuth ? "GitHub (gh) ✓" : "GitHub (gh) ✗";
  statusBar.appendChild(gh);
}

function fillDefaults(health) {
  if (health.defaultRepository) {
    form.repository.value = health.defaultRepository;
  }
  if (health.defaultPrNumber) {
    form.prNumber.value = health.defaultPrNumber;
  }
  if (health.model) {
    form.model.placeholder = health.model;
  }
}

function renderReportList(filter = "") {
  const term = filter.trim().toLowerCase();
  const items = reports.filter((r) => {
    if (!term) return true;
    const hay = `${r.owner}/${r.repo} ${r.pr} ${r.title}`.toLowerCase();
    return hay.includes(term);
  });

  reportList.innerHTML = "";
  if (!items.length) {
    reportList.innerHTML =
      '<li class="muted" style="padding:0.75rem">ยังไม่มี report</li>';
    return;
  }

  for (const r of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.path = r.path;
    btn.innerHTML = `<strong>${r.owner}/${r.repo}</strong> #${r.pr}<br><span class="muted">${escapeHtml(r.title)}</span>`;
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

async function loadReport(path, activeBtn) {
  document.querySelectorAll(".report-list button").forEach((b) => {
    b.classList.toggle("active", b === activeBtn);
  });

  const data = await api(`/api/reports/file?path=${encodeURIComponent(path)}`);
  reportEmpty.classList.add("hidden");
  reportView.classList.remove("hidden");
  reportTitle.textContent = path;
  reportBody.innerHTML = marked.parse(data.markdown);
  openReport.href = `/api/reports/file?path=${encodeURIComponent(path)}`;
  openReport.textContent = "Raw markdown";
}

async function refreshReports() {
  const data = await api("/api/reports");
  reports = data.reports || [];
  renderReportList(searchInput.value);
}

function appendLogs(lines, full) {
  jobLog.textContent = full.join("\n");
  jobLog.scrollTop = jobLog.scrollHeight;
}

async function pollJob(id) {
  const job = await api(`/api/jobs/${id}`);
  jobStatus.textContent = job.status;
  jobStatus.className = "badge " + job.status;
  appendLogs([], job.logs);

  if (job.status === "done") {
    runBtn.disabled = false;
    if (job.reportPath) {
      openReport.classList.remove("hidden");
      openReport.href = "#";
      openReport.textContent = "ดู report: " + job.reportPath;
      openReport.onclick = (e) => {
        e.preventDefault();
        loadReport(job.reportPath);
      };
    }
    await refreshReports();
    clearInterval(pollTimer);
    return;
  }

  if (job.status === "error") {
    runBtn.disabled = false;
    openReport.classList.add("hidden");
    clearInterval(pollTimer);
    return;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  runBtn.disabled = true;
  jobPanel.classList.remove("hidden");
  jobLog.textContent = "Starting...";
  openReport.classList.add("hidden");

  const body = {
    repository: form.repository.value.trim(),
    prNumber: Number(form.prNumber.value),
    postPrLink: form.postPrLink.checked,
    model: form.model.value.trim() || undefined,
  };

  try {
    const { jobId } = await api("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    jobIdEl.textContent = jobId;
    jobStatus.textContent = "queued";
    jobStatus.className = "badge running";

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => pollJob(jobId), 1200);
    await pollJob(jobId);
  } catch (err) {
    runBtn.disabled = false;
    jobStatus.textContent = "error";
    jobStatus.className = "badge error";
    jobLog.textContent = err.message;
  }
});

searchInput.addEventListener("input", () => renderReportList(searchInput.value));

async function init() {
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
