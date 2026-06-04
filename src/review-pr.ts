import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  createOctokit,
  fetchChangedFiles,
  fetchPullRequest,
  fetchPullRequestDiff,
  formatReviewComment,
  upsertReviewComment,
} from "./github.js";
import { runAiReview } from "./review.js";

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
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) {
    throw new Error("GITHUB_REPOSITORY is not set");
  }

  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repoFull}`);
  }

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

  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const { text } = await runAiReview({
    ...pr,
    diff,
    changedFiles,
    apiKey,
    model,
    cwd,
  });

  const commentBody = formatReviewComment(text);
  await upsertReviewComment(octokit, { owner, repo, number }, commentBody);

  core.info("Posted AI review comment on the pull request");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
  process.exit(1);
});
