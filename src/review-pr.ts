import * as core from "@actions/core";
import * as github from "@actions/github";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

// Load .env for local runs (no-op in CI if file missing)
loadDotenv();
import {
  createOctokit,
  fetchChangedFiles,
  fetchPullRequest,
  fetchPullRequestDiff,
  formatReviewComment,
  upsertReviewComment,
} from "./github.js";
import {
  formatPrLinkComment,
  resolveReportsDir,
  saveReport,
} from "./report.js";
import { runAiReview } from "./review.js";

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function resolvePullRequestNumber(): number {
  const fromEnv = process.env.PR_NUMBER?.trim();
  if (fromEnv) {
    const n = Number.parseInt(fromEnv, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`Invalid PR_NUMBER env: ${fromEnv}`);
    }
    return n;
  }

  const fromInput = core.getInput("pr_number");
  if (fromInput) {
    const n = Number.parseInt(fromInput, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`Invalid pr_number input: ${fromInput}`);
    }
    return n;
  }

  const pr = github.context.payload.pull_request;
  if (pr?.number) return pr.number;

  throw new Error(
    "No pull request in workflow context. Run on pull_request events or pass pr_number.",
  );
}

function resolveTargetRepository(): string {
  const target = process.env.TARGET_REPOSITORY?.trim();
  if (target) return target;

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) {
    throw new Error(
      "GITHUB_REPOSITORY or TARGET_REPOSITORY is required (owner/repo)",
    );
  }
  return repoFull;
}

async function main(): Promise<void> {
  const token =
    core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const apiKey =
    core.getInput("cursor_api_key") || process.env.CURSOR_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required. Add it as a repository secret.",
    );
  }

  const model = core.getInput("model") || process.env.REVIEW_MODEL || undefined;
  const repoFull = resolveTargetRepository();
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository: ${repoFull}`);
  }

  const postFullComment = parseBool(
    core.getInput("post_pr_comment") || process.env.POST_PR_COMMENT,
    false,
  );
  const postLinkOnly = parseBool(
    core.getInput("post_pr_link") || process.env.POST_PR_LINK,
    false,
  );

  const number = resolvePullRequestNumber();
  const octokit = createOctokit(token);

  core.info(`Fetching PR #${number} in ${owner}/${repo}`);
  const pr = await fetchPullRequest(octokit, { owner, repo, number });
  const [diff, changedFiles] = await Promise.all([
    fetchPullRequestDiff(octokit, { owner, repo, number }),
    fetchChangedFiles(octokit, { owner, repo, number }),
  ]);

  core.info(
    `Reviewing ${changedFiles.length} changed file(s), diff length ${diff.length}`,
  );

  const reviewCwd =
    process.env.REVIEW_CWD?.trim() ||
    process.env.GITHUB_WORKSPACE ||
    process.cwd();
  const reportsDir = resolveReportsDir(
    core.getInput("reports_dir") || process.env.REPORTS_DIR,
  );

  const { text } = await runAiReview({
    ...pr,
    diff,
    changedFiles,
    apiKey,
    model,
    cwd: path.resolve(reviewCwd),
  });

  const meta = await saveReport({
    reportsDir,
    pr,
    prUrl: pr.htmlUrl,
    review: text,
    model,
    filesChanged: changedFiles.length,
  });

  core.info(`Report saved: ${meta.path}`);
  core.setOutput("report_path", meta.path);
  core.setOutput("report_url", meta.reportUrl);

  if (postFullComment) {
    await upsertReviewComment(
      octokit,
      { owner, repo, number },
      formatReviewComment(text),
    );
    core.info("Posted full AI review on the pull request");
  } else if (postLinkOnly) {
    await upsertReviewComment(
      octokit,
      { owner, repo, number },
      formatPrLinkComment(meta),
    );
    core.info("Posted report link on the pull request");
  } else {
    core.info("Skipped PR comment (report only in hub repo)");
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
  process.exit(1);
});
