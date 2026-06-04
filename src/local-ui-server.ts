import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { getGhToken } from "./checkout.js";
import { resolveReviewMode } from "./config.js";
import { runHubReview, HUB_ROOT } from "./hub-review.js";
import type { PullRequestState } from "./github.js";
import {
  createOctokit,
  filterRepositories,
  getAuthenticatedUser,
  listPullRequestsResolved,
  listRepositoriesResolved,
} from "./github.js";
import { readReportsIndex, resolveReportsDir } from "./report.js";
import type { FindingSeverity } from "./core/types.js";

loadDotenv();

const ROOT = HUB_ROOT;
const UI_DIR = path.join(ROOT, "ui");
const PORT = Number.parseInt(process.env.UI_PORT ?? "3847", 10);

type JobStatus = "queued" | "running" | "done" | "error";

type JobEvent =
  | { type: "log"; line: string }
  | {
      type: "status";
      status: JobStatus;
      verdict?: string;
      reportPath?: string;
      reportUrl?: string;
      error?: string;
    };

type Job = {
  id: string;
  status: JobStatus;
  logs: string[];
  listeners: Set<(event: JobEvent) => void>;
  error?: string;
  reportPath?: string;
  reportUrl?: string;
  verdict?: string;
  startedAt: string;
  finishedAt?: string;
};

const jobs = new Map<string, Job>();
let jobCounter = 0;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeReportPath(rel: string): string | null {
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(ROOT, normalized);
  const reportsRoot = path.join(ROOT, "reports");
  if (!full.startsWith(reportsRoot)) return null;
  return full;
}

function emitJob(job: Job, event: JobEvent): void {
  for (const listener of job.listeners) {
    listener(event);
  }
}

function appendLog(job: Job, line: string): void {
  job.logs.push(line);
  if (job.logs.length > 500) job.logs.shift();
  emitJob(job, { type: "log", line });
}

function setJobStatus(job: Job, status: JobStatus): void {
  job.status = status;
  emitJob(job, {
    type: "status",
    status,
    verdict: job.verdict,
    reportPath: job.reportPath,
    reportUrl: job.reportUrl,
    error: job.error,
  });
}

async function runReviewJob(
  job: Job,
  input: {
    repository: string;
    prNumber: number;
    postPrLink: boolean;
    postInline: boolean;
    incremental: boolean;
    model?: string;
    mode?: string;
  },
): Promise<void> {
  setJobStatus(job, "running");

  try {
    appendLog(job, `PR #${input.prNumber} · ${input.repository}`);
    const token = getGhToken();

    const { meta } = await runHubReview({
      repository: input.repository,
      prNumber: input.prNumber,
      token,
      apiKey: process.env.CURSOR_API_KEY!,
      model: input.model,
      mode: resolveReviewMode(input.mode),
      incremental: input.incremental,
      githubFeedback: {
        postLink: input.postPrLink,
        postInline: input.postInline,
      },
      onLog: (msg) => appendLog(job, msg),
    });

    job.reportPath = meta.path;
    job.reportUrl = meta.reportUrl;
    job.verdict = meta.verdict;
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Done · verdict=${meta.verdict}`);
    setJobStatus(job, "done");
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Error: ${job.error}`);
    setJobStatus(job, "error");
  }
}

function streamJobEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  job: Job,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: JobEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const line of job.logs) {
    send({ type: "log", line });
  }
  send({
    type: "status",
    status: job.status,
    verdict: job.verdict,
    reportPath: job.reportPath,
    reportUrl: job.reportUrl,
    error: job.error,
  });

  const listener = (event: JobEvent) => send(event);
  job.listeners.add(listener);

  req.on("close", () => {
    job.listeners.delete(listener);
    if (!res.writableEnded) res.end();
  });

  if (job.status === "done" || job.status === "error") {
    job.listeners.delete(listener);
    res.end();
  }
}

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
): boolean {
  const file = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = path.join(UI_DIR, file);
  if (!filePath.startsWith(UI_DIR)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;

  const ext = path.extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };

  res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
  return true;
}

function loadReportPayload(mdPath: string) {
  const raw = fs.readFileSync(mdPath, "utf8");
  const markdown = raw.replace(/^---[\s\S]*?---\n*/, "");
  const jsonPath = mdPath.replace(/\.md$/i, ".json");
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      meta?: unknown;
      summary?: string;
      findings?: unknown[];
      counts?: Record<FindingSeverity, number>;
    };
    return { markdown, raw, ...data };
  }
  return { markdown, raw, findings: [], counts: null };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && !url.pathname.startsWith("/api")) {
      if (serveStatic(req, res, url.pathname)) return;
      res.writeHead(404).end("Not found");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const hasKey = Boolean(process.env.CURSOR_API_KEY?.trim());
      let ghOk = false;
      try {
        getGhToken();
        ghOk = true;
      } catch {
        ghOk = false;
      }
      json(res, 200, {
        ok: true,
        apiVersion: 2,
        cursorApiKey: hasKey,
        githubAuth: ghOk,
        defaultRepository:
          process.env.TARGET_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "",
        defaultPrNumber: process.env.PR_NUMBER ?? "",
        defaultReviewMode: resolveReviewMode(),
        model: process.env.REVIEW_MODEL ?? "composer-2.5",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/github/me") {
      try {
        const token = getGhToken();
        const user = await getAuthenticatedUser(createOctokit(token));
        json(res, 200, user);
      } catch (err) {
        json(res, 401, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/repos") {
      try {
        const token = getGhToken();
        const q = url.searchParams.get("q")?.trim() ?? "";
        const limit = Math.min(
          Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100,
          100,
        );
        const { repos, source } = await listRepositoriesResolved(
          createOctokit(token),
          { limit },
        );
        const filtered = filterRepositories(repos, q);
        json(res, 200, {
          repos: filtered,
          total: repos.length,
          source,
          hint:
            filtered.length === 0
              ? q
                ? `ไม่พบ repo ที่ตรง "${q}"`
                : "ไม่พบ repo — ลอง gh auth login หรือ GITHUB_TOKEN"
              : undefined,
        });
      } catch (err) {
        json(res, 401, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/pulls") {
      const repository = url.searchParams.get("repository")?.trim();
      if (!repository || !repository.includes("/")) {
        json(res, 400, { error: "repository query required (owner/repo)" });
        return;
      }
      const stateParam = url.searchParams.get("state")?.trim() || "all";
      const state = (["open", "closed", "all"].includes(stateParam)
        ? stateParam
        : "all") as PullRequestState;
      const [owner, repo] = repository.split("/");
      const token = getGhToken();
      const { pulls, source } = await listPullRequestsResolved(
        createOctokit(token),
        { owner: owner!, repo: repo! },
        { limit: 30, state },
      );
      json(res, 200, {
        repository,
        state,
        pulls,
        source,
        hint:
          pulls.length === 0
            ? "ไม่พบ PR — ลอง state=closed หรือใส่เลข PR เอง"
            : undefined,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reports") {
      const index = await readReportsIndex(resolveReportsDir());
      json(res, 200, index);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reports/file") {
      const rel = url.searchParams.get("path");
      if (!rel) {
        json(res, 400, { error: "path required" });
        return;
      }
      const full = safeReportPath(rel);
      if (!full || !fs.existsSync(full)) {
        json(res, 404, { error: "report not found" });
        return;
      }
      const severity = url.searchParams.get("severity") as FindingSeverity | null;
      const payload = loadReportPayload(full);
      if (severity && Array.isArray(payload.findings)) {
        payload.findings = (payload.findings as { severity: string }[]).filter(
          (f) => f.severity === severity,
        );
      }
      json(res, 200, { path: rel, ...payload });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/review") {
      const body = JSON.parse(await readBody(req)) as {
        repository?: string;
        prNumber?: number;
        postPrLink?: boolean;
        postInline?: boolean;
        incremental?: boolean;
        model?: string;
        mode?: string;
      };

      const repository = body.repository?.trim();
      const prNumber = body.prNumber;
      if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        json(res, 400, { error: "repository must be owner/repo" });
        return;
      }
      if (!prNumber || prNumber < 1) {
        json(res, 400, { error: "prNumber required" });
        return;
      }
      if (!process.env.CURSOR_API_KEY?.trim()) {
        json(res, 400, { error: "CURSOR_API_KEY missing in .env" });
        return;
      }

      const id = `job-${++jobCounter}`;
      const job: Job = {
        id,
        status: "queued",
        logs: [],
        listeners: new Set(),
        startedAt: new Date().toISOString(),
      };
      jobs.set(id, job);
      setJobStatus(job, "queued");

      void runReviewJob(job, {
        repository,
        prNumber,
        postPrLink: Boolean(body.postPrLink),
        postInline: Boolean(body.postInline),
        incremental: Boolean(body.incremental),
        model: body.model,
        mode: body.mode,
      });

      json(res, 202, { jobId: id });
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/jobs/") &&
      url.pathname.endsWith("/stream")
    ) {
      const id = url.pathname
        .slice("/api/jobs/".length)
        .replace(/\/stream$/, "");
      const job = jobs.get(id);
      if (!job) {
        json(res, 404, { error: "job not found" });
        return;
      }
      streamJobEvents(req, res, job);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = jobs.get(id);
      if (!job) {
        json(res, 404, { error: "job not found" });
        return;
      }
      const { listeners: _l, ...publicJob } = job;
      json(res, 200, publicJob);
      return;
    }

    res.writeHead(404).end("Not found");
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Local Review UI → http://127.0.0.1:${PORT}`);
  console.log(`  PR list: open + closed + merged (state=all)\n`);
});
