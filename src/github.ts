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
};

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
  };
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
