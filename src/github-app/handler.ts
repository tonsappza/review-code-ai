import { parseBool } from "../config.js";
import { runHubReview } from "../hub-review.js";
import { getInstallationToken } from "./auth.js";
import type { GitHubAppConfig } from "./config.js";

const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export type WebhookJob = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  repository: string;
  pr: number;
  action: string;
  logs: string[];
  error?: string;
  reportPath?: string;
  startedAt: string;
  finishedAt?: string;
};

const jobs = new Map<string, WebhookJob>();
let jobSeq = 0;

export function getWebhookJob(id: string): WebhookJob | undefined {
  return jobs.get(id);
}

export function listWebhookJobs(limit = 20): WebhookJob[] {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

type PullRequestPayload = {
  action: string;
  installation?: { id: number };
  repository?: {
    full_name?: string;
    name: string;
    owner: { login: string };
  };
  pull_request?: { number: number };
};

export function parsePullRequestEvent(
  body: unknown,
): PullRequestPayload | null {
  if (!body || typeof body !== "object") return null;
  const p = body as PullRequestPayload;
  if (!p.repository?.owner?.login || !p.repository?.name) return null;
  if (!p.pull_request?.number) return null;
  if (!p.installation?.id) return null;
  return p;
}

export async function handleGitHubWebhook(
  config: GitHubAppConfig,
  event: string,
  payload: unknown,
): Promise<{ accepted: boolean; jobId?: string; reason?: string }> {
  if (event !== "pull_request") {
    return { accepted: false, reason: `ignored event: ${event}` };
  }

  const pr = parsePullRequestEvent(payload);
  if (!pr) {
    return { accepted: false, reason: "invalid pull_request payload" };
  }

  if (!HANDLED_ACTIONS.has(pr.action)) {
    return { accepted: false, reason: `ignored action: ${pr.action}` };
  }

  const repository = `${pr.repository!.owner.login}/${pr.repository!.name}`;
  const prNumber = pr.pull_request!.number;
  const installationId = pr.installation!.id;

  const id = `wh-${++jobSeq}`;
  const job: WebhookJob = {
    id,
    status: "queued",
    repository,
    pr: prNumber,
    action: pr.action,
    logs: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  void processJob(config, job, installationId);

  return { accepted: true, jobId: id };
}

async function processJob(
  config: GitHubAppConfig,
  job: WebhookJob,
  installationId: number,
): Promise<void> {
  const log = (m: string) => {
    job.logs.push(m);
    if (job.logs.length > 300) job.logs.shift();
  };

  job.status = "running";

  try {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

    log(`Installation ${installationId}`);
    const token = await getInstallationToken(config, installationId);

    const postLink = parseBool(process.env.GITHUB_APP_POST_PR_LINK, true);
    const postInline = parseBool(process.env.GITHUB_APP_POST_INLINE, false);

    const { meta } = await runHubReview({
      repository: job.repository,
      prNumber: job.pr,
      token,
      apiKey,
      githubFeedback: { postLink, postInline },
      onLog: log,
    });

    job.reportPath = meta.path;
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    log(`Done → ${meta.path}`);
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.status = "error";
    job.finishedAt = new Date().toISOString();
    log(`Error: ${job.error}`);
  }
}
