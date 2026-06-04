import type { FindingSeverity } from "./core/types.js";
import {
  buildInlineComments,
  parseMinSeverity,
} from "./core/inline-comments.js";
import type { ParsedReview } from "./core/types.js";
import type { ReportMeta } from "./report.js";
import { formatPrLinkComment } from "./report.js";
import {
  createOctokit,
  createPullRequestReview,
  fetchPullRequestFileChanges,
  formatReviewComment,
  upsertReviewComment,
  type PullRequestContext,
} from "./github.js";

export type GithubFeedbackOptions = {
  postLink?: boolean;
  postFull?: boolean;
  postInline?: boolean;
  inlineMinSeverity?: FindingSeverity;
};

export type GithubFeedbackResult = {
  linkPosted: boolean;
  fullPosted: boolean;
  inlinePosted: number;
  inlineSkipped: number;
};

export async function postGithubReviewFeedback(input: {
  token: string;
  ctx: Pick<PullRequestContext, "owner" | "repo" | "number">;
  meta: ReportMeta;
  parsed: ParsedReview;
  markdown: string;
  options: GithubFeedbackOptions;
  onLog?: (message: string) => void;
}): Promise<GithubFeedbackResult> {
  const result: GithubFeedbackResult = {
    linkPosted: false,
    fullPosted: false,
    inlinePosted: 0,
    inlineSkipped: 0,
  };

  const { postLink, postFull, postInline } = input.options;
  if (!postLink && !postFull && !postInline) return result;

  const octokit = createOctokit(input.token);
  const log = (m: string) => input.onLog?.(m);

  if (postFull) {
    await upsertReviewComment(
      octokit,
      input.ctx,
      formatReviewComment(input.markdown),
    );
    result.fullPosted = true;
    log("Posted full review comment on PR");
  } else if (postLink) {
    await upsertReviewComment(
      octokit,
      input.ctx,
      formatPrLinkComment(input.meta),
    );
    result.linkPosted = true;
    log("Posted report link on PR");
  }

  if (!postInline) return result;

  const fileChanges = await fetchPullRequestFileChanges(octokit, input.ctx);
  const patchMap = new Map(
    fileChanges.map((f) => [f.filename, f.patch] as const),
  );
  const changedNames = new Set(fileChanges.map((f) => f.filename));

  const minSeverity = parseMinSeverity(
    input.options.inlineMinSeverity ?? process.env.INLINE_MIN_SEVERITY,
  );
  const inline = buildInlineComments({
    findings: input.parsed.findings,
    changedFiles: patchMap,
    minSeverity,
  });

  const skipped =
    input.parsed.findings.filter(
      (f) =>
        f.file &&
        changedNames.has(f.file.replace(/\\/g, "/")) &&
        (!f.line || !patchMap.get(f.file.replace(/\\/g, "/"))),
    ).length;

  result.inlineSkipped = Math.max(
    0,
    input.parsed.findings.length - inline.length - skipped,
  );

  const summary =
    input.parsed.summary?.trim() ||
    `AI review · verdict **${input.meta.verdict}**`;

  const body = [
    "<!-- review-code-ai -->",
    `## 🤖 AI Code Review (\`${input.meta.verdict}\`)`,
    "",
    summary,
    "",
    input.meta.reportUrl
      ? `[Full report in hub](${input.meta.reportUrl})`
      : "",
    inline.length > 0
      ? `\n_${inline.length} inline comment(s) on this review._`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const event =
    input.meta.verdict === "fail" ? "REQUEST_CHANGES" : "COMMENT";

  try {
    await createPullRequestReview(octokit, {
      ...input.ctx,
      body,
      event,
      comments: inline.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    });
    result.inlinePosted = inline.length;
    log(
      `Posted PR review (${event}) with ${inline.length} inline comment(s), min severity ${minSeverity}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Inline review failed: ${msg}`);
    if (!result.linkPosted && !result.fullPosted) {
      await upsertReviewComment(
        octokit,
        input.ctx,
        formatPrLinkComment(input.meta),
      );
      result.linkPosted = true;
      log("Fell back to report link comment on PR");
    }
  }

  return result;
}
