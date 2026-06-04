import path from "node:path";
import {
  createOctokit,
  fetchChangedFiles,
  fetchPullRequest,
  fetchPullRequestDiff,
  fetchPullRequestFileChanges,
  listPullRequests,
} from "../github.js";
import type { ReportMeta } from "../report.js";
import { saveReport } from "../report.js";
import { resolveReviewMode } from "../config.js";
import {
  postGithubReviewFeedback,
  type GithubFeedbackOptions,
} from "../github-feedback.js";
import { parseReviewMarkdown } from "./parse-findings.js";
import { runAiReview } from "./run-ai.js";
import type { ParsedReview, ReviewMode } from "./types.js";
import { verdictFromCounts } from "./types.js";

export type PipelineInput = {
  token: string;
  repository: string;
  prNumber: number;
  apiKey: string;
  model?: string;
  mode?: ReviewMode;
  reviewCwd: string;
  reportsDir: string;
  onLog?: (message: string) => void;
  githubFeedback?: GithubFeedbackOptions;
  incremental?: boolean;
};

export type PipelineResult = {
  meta: ReportMeta;
  parsed: ParsedReview;
  markdown: string;
};

function log(onLog: PipelineInput["onLog"], message: string): void {
  onLog?.(message);
}

export async function runReviewPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const [owner, repo] = input.repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository: ${input.repository}`);
  }

  const mode = input.mode ?? resolveReviewMode();
  const octokit = createOctokit(input.token);
  const reviewCwd = path.resolve(input.reviewCwd);

  log(input.onLog, `Fetching PR #${input.prNumber} in ${input.repository}...`);
  const pr = await fetchPullRequest(octokit, {
    owner,
    repo,
    number: input.prNumber,
  });

  const [diff, changedFiles, fileChanges] = await Promise.all([
    fetchPullRequestDiff(octokit, { owner, repo, number: input.prNumber }),
    fetchChangedFiles(octokit, { owner, repo, number: input.prNumber }),
    fetchPullRequestFileChanges(octokit, { owner, repo, number: input.prNumber }),
  ]);

  log(
    input.onLog,
    `Mode: ${mode} | ${changedFiles.length} file(s) | diff ${diff.length} chars`,
  );
  log(input.onLog, "Running Cursor AI review...");

  const markdown = await runAiReview({
    mode,
    reviewCwd,
    title: pr.title,
    body: pr.body,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    diff,
    changedFiles,
    fileChanges,
    apiKey: input.apiKey,
    model: input.model,
    reportsDir: input.reportsDir,
    repository: input.repository,
    prNumber: input.prNumber,
    incremental: input.incremental,
    onLog: input.onLog,
  });

  const parsed = parseReviewMarkdown(markdown);
  const verdict = verdictFromCounts(parsed.counts);

  log(
    input.onLog,
    `Findings: critical=${parsed.counts.critical} major=${parsed.counts.major} minor=${parsed.counts.minor} suggestion=${parsed.counts.suggestion} → ${verdict}`,
  );

  const meta = await saveReport({
    reportsDir: input.reportsDir,
    pr,
    prUrl: pr.htmlUrl,
    review: markdown,
    model: input.model,
    filesChanged: changedFiles.length,
    mode,
    parsed,
    verdict,
  });

  log(input.onLog, `Report saved: ${meta.path}`);

  if (input.githubFeedback) {
    await postGithubReviewFeedback({
      token: input.token,
      ctx: { owner, repo, number: input.prNumber },
      meta,
      parsed,
      markdown,
      options: input.githubFeedback,
      onLog: input.onLog,
    });
  }

  return { meta, parsed, markdown };
}

export { listPullRequests, listPullRequests as listOpenPullRequests };
