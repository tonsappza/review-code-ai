import { config as loadDotenv } from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clonePrHead, getGhToken } from "./checkout.js";
import { resolveReportsDir } from "./report.js";
import type { ReportsIndex } from "./report.js";

loadDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UI_DIR = path.join(ROOT, "ui");
const PORT = Number.parseInt(process.env.UI_PORT ?? "3847", 10);

type JobStatus = "queued" | "running" | "done" | "error";

type Job = {
  id: string;
  status: JobStatus;
  logs: string[];
  error?: string;
  reportPath?: string;
  reportUrl?: string;
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

function appendLog(job: Job, line: string): void {
  job.logs.push(line);
  if (job.logs.length > 500) job.logs.shift();
}

async function runReviewJob(
  job: Job,
  input: {
    repository: string;
    prNumber: number;
    postPrLink: boolean;
    model?: string;
  },
): Promise<void> {
  job.status = "running";
  const targetDir = path.join(ROOT, ".review-target");
  const reportsDir = resolveReportsDir();

  try {
    appendLog(job, `Fetching PR #${input.prNumber} in ${input.repository}...`);
    const token = getGhToken();

    appendLog(job, "Cloning PR head branch...");
    clonePrHead({
      repository: input.repository,
      prNumber: input.prNumber,
      targetDir,
    });

    appendLog(job, "Running Cursor AI review (1–5 min)...");

    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["run", "review"], {
        cwd: ROOT,
        env: {
          ...process.env,
          GITHUB_TOKEN: token,
          GITHUB_REPOSITORY: input.repository,
          TARGET_REPOSITORY: input.repository,
          PR_NUMBER: String(input.prNumber),
          REVIEW_CWD: targetDir,
          REPORTS_DIR: reportsDir,
          POST_PR_COMMENT: "false",
          POST_PR_LINK: input.postPrLink ? "true" : "false",
          REVIEW_MODEL: input.model ?? process.env.REVIEW_MODEL ?? "composer-2.5",
        },
        shell: true,
      });

      child.stdout?.on("data", (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) {
          if (line.trim() && !line.startsWith("::set-output")) {
            appendLog(job, line);
          }
        }
      });
      child.stderr?.on("data", (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) {
          if (line.trim()) appendLog(job, `[stderr] ${line}`);
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Review exited with code ${code}`));
      });
    });

    const [owner, repo] = input.repository.split("/");
    const rel = `reports/${owner}/${repo}/pr-${input.prNumber}.md`;
    const hub = process.env.REPORTS_HUB_REPO ?? "tonsappza/review-code-ai";
    const branch = process.env.REPORTS_HUB_BRANCH ?? "master";

    job.reportPath = rel;
    job.reportUrl = `https://github.com/${hub}/blob/${branch}/${rel}`;
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Done → ${rel}`);
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Error: ${job.error}`);
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
        cursorApiKey: hasKey,
        githubAuth: ghOk,
        defaultRepository:
          process.env.TARGET_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "",
        defaultPrNumber: process.env.PR_NUMBER ?? "",
        model: process.env.REVIEW_MODEL ?? "composer-2.5",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reports") {
      const indexPath = path.join(resolveReportsDir(), "index.json");
      if (!fs.existsSync(indexPath)) {
        json(res, 200, { updatedAt: null, reports: [] });
        return;
      }
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as ReportsIndex;
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
      const raw = fs.readFileSync(full, "utf8");
      const body = raw.replace(/^---[\s\S]*?---\n*/, "");
      json(res, 200, { path: rel, markdown: body, raw });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/review") {
      const body = JSON.parse(await readBody(req)) as {
        repository?: string;
        prNumber?: number;
        postPrLink?: boolean;
        model?: string;
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
        startedAt: new Date().toISOString(),
      };
      jobs.set(id, job);

      void runReviewJob(job, {
        repository,
        prNumber,
        postPrLink: Boolean(body.postPrLink),
        model: body.model,
      });

      json(res, 202, { jobId: id });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = jobs.get(id);
      if (!job) {
        json(res, 404, { error: "job not found" });
        return;
      }
      json(res, 200, job);
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
  console.log(`\n  Local Review UI → http://127.0.0.1:${PORT}\n`);
});
