import * as core from "@actions/core";
import * as github from "@actions/github";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { parseBool, resolveReviewMode } from "./config.js";
import { runReviewPipeline } from "./core/pipeline.js";
import type { GithubFeedbackOptions } from "./github-feedback.js";
import { resolveReportsDir } from "./report.js";

loadDotenv();

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

function resolveGithubFeedback(): GithubFeedbackOptions {
  return {
    postFull: parseBool(
      core.getInput("post_pr_comment") || process.env.POST_PR_COMMENT,
      false,
    ),
    postLink: parseBool(
      core.getInput("post_pr_link") || process.env.POST_PR_LINK,
      false,
    ),
    postInline: parseBool(
      core.getInput("post_inline_comments") ||
        process.env.POST_INLINE_COMMENTS,
      false,
    ),
  };
}

async function main(): Promise<void> {
  const token =
    core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
  if (!token) throw new Error("GITHUB_TOKEN is required");

  const apiKey =
    core.getInput("cursor_api_key") || process.env.CURSOR_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required. Add it as a repository secret.",
    );
  }

  const model = core.getInput("model") || process.env.REVIEW_MODEL || undefined;
  const repository = resolveTargetRepository();
  const mode = resolveReviewMode(
    core.getInput("review_mode") || process.env.REVIEW_MODE,
  );

  const prNumber = resolvePullRequestNumber();
  const reviewCwd =
    process.env.REVIEW_CWD?.trim() ||
    process.env.GITHUB_WORKSPACE ||
    process.cwd();
  const reportsDir = resolveReportsDir(
    core.getInput("reports_dir") || process.env.REPORTS_DIR,
  );

  const githubFeedback = resolveGithubFeedback();
  const incremental = parseBool(
    core.getInput("incremental") || process.env.INCREMENTAL_REVIEW,
    false,
  );

  const { meta } = await runReviewPipeline({
    token,
    repository,
    prNumber,
    apiKey,
    model,
    mode,
    reviewCwd: path.resolve(reviewCwd),
    reportsDir,
    githubFeedback,
    incremental,
    onLog: (msg) => core.info(msg),
  });

  core.setOutput("report_path", meta.path);
  core.setOutput("report_url", meta.reportUrl);
  core.setOutput("verdict", meta.verdict);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
  process.exit(1);
});
