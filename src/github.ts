import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

const MAX_DIFF_CHARS = 120_000;

export type PullRequestContext = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  htmlUrl: string;
};

export type PrFileChange = {
  filename: string;
  patch?: string;
  status: string;
};

export type { Octokit } from "@octokit/rest";

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function fetchPullRequest(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
): Promise<PullRequestContext> {
  const { data } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.number,
  });

  return {
    owner: ctx.owner,
    repo: ctx.repo,
    number: ctx.number,
    title: data.title,
    body: data.body ?? "",
    baseRef: data.base.ref,
    headRef: data.head.ref,
    headSha: data.head.sha,
    htmlUrl: data.html_url,
  };
}

export async function fetchPullRequestFileChanges(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
): Promise<PrFileChange[]> {
  const files: PrFileChange[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.number,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;
    files.push(
      ...data.map((f) => ({
        filename: f.filename,
        patch: f.patch ?? undefined,
        status: f.status,
      })),
    );
    if (data.length < 100) break;
    page += 1;
  }

  return files;
}

export type PullRequestReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export async function createPullRequestReview(
  octokit: Octokit,
  input: Pick<PullRequestContext, "owner" | "repo" | "number"> & {
    body: string;
    event: PullRequestReviewEvent;
    comments: Array<{ path: string; line: number; body: string }>;
  },
): Promise<void> {
  const { data: pr } = await octokit.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.number,
  });

  await octokit.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.number,
    commit_id: pr.head.sha,
    body: input.body,
    event: input.event,
    comments: input.comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: "RIGHT" as const,
      body: c.body,
    })),
  });
}

export async function fetchChangedFiles(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
): Promise<string[]> {
  const files: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.number,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;
    files.push(...data.map((f) => f.filename));
    if (data.length < 100) break;
    page += 1;
  }

  return files;
}

export type PullRequestState = "open" | "closed" | "all";

export type PullRequestListItem = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  headRefName: string;
  state: string;
  merged: boolean;
};

export async function listPullRequests(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo">,
  options?: { limit?: number; state?: PullRequestState },
): Promise<PullRequestListItem[]> {
  const limit = options?.limit ?? 30;
  const state = options?.state ?? "all";

  const { data } = await octokit.pulls.list({
    owner: ctx.owner,
    repo: ctx.repo,
    state,
    per_page: Math.min(limit, 100),
    sort: "updated",
    direction: "desc",
  });

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    updatedAt: pr.updated_at,
    headRefName: pr.head.ref,
    state: pr.state,
    merged: Boolean(pr.merged_at),
  }));
}

/** Fallback when Octokit returns empty — uses local `gh` CLI (same as terminal). */
export function listPullRequestsViaGh(
  repository: string,
  options?: { limit?: number; state?: PullRequestState },
): PullRequestListItem[] {
  const limit = options?.limit ?? 30;
  const state = options?.state ?? "all";

  const json = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,url,updatedAt,headRefName,state,mergedAt",
    ],
    { encoding: "utf8" },
  );

  const rows = JSON.parse(json) as Array<{
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    headRefName: string;
    state: string;
    mergedAt?: string | null;
  }>;

  return rows.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    updatedAt: pr.updatedAt,
    headRefName: pr.headRefName,
    state: pr.state,
    merged: Boolean(pr.mergedAt),
  }));
}

export async function listPullRequestsResolved(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo">,
  options?: { limit?: number; state?: PullRequestState },
): Promise<{ pulls: PullRequestListItem[]; source: "api" | "gh-cli" }> {
  const repository = `${ctx.owner}/${ctx.repo}`;
  let pulls = await listPullRequests(octokit, ctx, options);
  if (pulls.length > 0) return { pulls, source: "api" };

  try {
    pulls = listPullRequestsViaGh(repository, options);
    return { pulls, source: "gh-cli" };
  } catch {
    return { pulls: [], source: "api" };
  }
}

/** @deprecated Use listPullRequests */
export const listOpenPullRequests = listPullRequests;

export async function fetchPullRequestDiff(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
): Promise<string> {
  const response = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.number,
    mediaType: { format: "diff" },
  });

  const diff =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);

  if (diff.length <= MAX_DIFF_CHARS) return diff;

  const truncated = diff.slice(0, MAX_DIFF_CHARS);
  return (
    truncated +
    `\n\n... [diff truncated at ${MAX_DIFF_CHARS} characters — review may be incomplete]`
  );
}

const REVIEW_MARKER = "<!-- review-code-ai -->";

export function formatReviewComment(review: string): string {
  return `${REVIEW_MARKER}\n## 🤖 AI Code Review\n\n${review.trim()}\n\n---\n*Powered by [review-code-ai](https://github.com) · Cursor SDK*`;
}

export async function findExistingReviewCommentId(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
): Promise<number | undefined> {
  const { data: comments } = await octokit.issues.listComments({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.number,
    per_page: 100,
  });

  const existing = comments.find(
    (c) =>
      c.user?.type === "Bot" &&
      typeof c.body === "string" &&
      c.body.includes(REVIEW_MARKER),
  );

  return existing?.id;
}

export async function upsertReviewComment(
  octokit: Octokit,
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">,
  body: string,
): Promise<void> {
  const existingId = await findExistingReviewCommentId(octokit, ctx);

  if (existingId) {
    await octokit.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existingId,
      body,
    });
    return;
  }

  await octokit.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.number,
    body,
  });
}
