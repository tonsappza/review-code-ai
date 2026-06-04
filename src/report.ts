import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedReview, ReviewMode, ReviewVerdict } from "./core/types.js";
import type { PullRequestContext } from "./github.js";

export type ReportMeta = {
  id: string;
  owner: string;
  repo: string;
  pr: number;
  title: string;
  prUrl: string;
  reportUrl: string;
  reviewedAt: string;
  model?: string;
  filesChanged: number;
  path: string;
  jsonPath: string;
  reviewMode: ReviewMode;
  verdict: ReviewVerdict;
  findingCounts: ParsedReview["counts"];
};

export type ReportsIndex = {
  updatedAt: string;
  reports: ReportMeta[];
};

const MAX_INDEX_ENTRIES = 200;

export function reportId(
  owner: string,
  repo: string,
  pr: number,
): string {
  return `${owner}-${repo}-pr-${pr}`;
}

export function reportRelativePath(
  owner: string,
  repo: string,
  pr: number,
): string {
  return path.join(owner, repo, `pr-${pr}.md`);
}

export function reportJsonRelativePath(
  owner: string,
  repo: string,
  pr: number,
): string {
  return path.join(owner, repo, `pr-${pr}.json`);
}

export function resolveReportsDir(base?: string): string {
  const dir = base?.trim() || process.env.REPORTS_DIR?.trim() || "reports";
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

function reportPublicUrl(owner: string, repo: string, pr: number): string {
  const hub =
    process.env.REPORTS_HUB_REPO?.trim() || "tonsappza/review-code-ai";
  const branch = process.env.REPORTS_HUB_BRANCH?.trim() || "master";
  const rel = reportRelativePath(owner, repo, pr).replace(/\\/g, "/");
  return `https://github.com/${hub}/blob/${branch}/reports/${rel}`;
}

export function buildReportMarkdown(input: {
  meta: {
    owner: string;
    repo: string;
    pr: number;
    title: string;
    prUrl: string;
    reviewedAt: string;
    model?: string;
    filesChanged: number;
    reviewMode: ReviewMode;
    verdict: ReviewVerdict;
    findingCounts: ParsedReview["counts"];
  };
  review: string;
}): string {
  const id = reportId(input.meta.owner, input.meta.repo, input.meta.pr);
  const c = input.meta.findingCounts;
  const frontmatter = [
    "---",
    `id: ${id}`,
    `owner: ${input.meta.owner}`,
    `repo: ${input.meta.repo}`,
    `pr: ${input.meta.pr}`,
    `title: ${JSON.stringify(input.meta.title)}`,
    `prUrl: ${input.meta.prUrl}`,
    `reviewedAt: ${input.meta.reviewedAt}`,
    `model: ${input.meta.model ?? "composer-2.5"}`,
    `filesChanged: ${input.meta.filesChanged}`,
    `reviewMode: ${input.meta.reviewMode}`,
    `verdict: ${input.meta.verdict}`,
    `findingsCritical: ${c.critical}`,
    `findingsMajor: ${c.major}`,
    `findingsMinor: ${c.minor}`,
    `findingsSuggestion: ${c.suggestion}`,
    "---",
  ].join("\n");

  const badges = [
    input.meta.verdict === "pass"
      ? "pass"
      : input.meta.verdict === "warn"
        ? "warn"
        : "fail",
    input.meta.reviewMode,
    `C${c.critical} M${c.major} m${c.minor} s${c.suggestion}`,
  ].join(" · ");

  return `${frontmatter}\n\n# AI Code Review\n\n**${input.meta.title}**\n\n- PR: [#${input.meta.pr}](${input.meta.prUrl})\n- Reviewed: ${input.meta.reviewedAt}\n- Mode: \`${input.meta.reviewMode}\` | Verdict: **${input.meta.verdict}** (${badges})\n- Files changed: ${input.meta.filesChanged}\n\n---\n\n${input.review.trim()}`;
}

export async function saveReport(input: {
  reportsDir: string;
  pr: PullRequestContext;
  prUrl: string;
  review: string;
  model?: string;
  filesChanged: number;
  mode: ReviewMode;
  parsed: ParsedReview;
  verdict: ReviewVerdict;
}): Promise<ReportMeta> {
  const reportsDir = resolveReportsDir(input.reportsDir);
  const rel = reportRelativePath(input.pr.owner, input.pr.repo, input.pr.number);
  const jsonRel = reportJsonRelativePath(
    input.pr.owner,
    input.pr.repo,
    input.pr.number,
  );
  const filePath = path.join(reportsDir, rel);
  const jsonPath = path.join(reportsDir, jsonRel);
  const reviewedAt = new Date().toISOString();

  const meta: ReportMeta = {
    id: reportId(input.pr.owner, input.pr.repo, input.pr.number),
    owner: input.pr.owner,
    repo: input.pr.repo,
    pr: input.pr.number,
    title: input.pr.title,
    prUrl: input.prUrl,
    reportUrl: reportPublicUrl(input.pr.owner, input.pr.repo, input.pr.number),
    reviewedAt,
    model: input.model,
    filesChanged: input.filesChanged,
    path: `reports/${rel.replace(/\\/g, "/")}`,
    jsonPath: `reports/${jsonRel.replace(/\\/g, "/")}`,
    reviewMode: input.mode,
    verdict: input.verdict,
    findingCounts: input.parsed.counts,
  };

  const markdown = buildReportMarkdown({
    meta: {
      owner: meta.owner,
      repo: meta.repo,
      pr: meta.pr,
      title: meta.title,
      prUrl: meta.prUrl,
      reviewedAt: meta.reviewedAt,
      model: meta.model,
      filesChanged: meta.filesChanged,
      reviewMode: meta.reviewMode,
      verdict: meta.verdict,
      findingCounts: meta.findingCounts,
    },
    review: input.review,
  });

  const jsonPayload = {
    meta,
    summary: input.parsed.summary,
    findings: input.parsed.findings,
    counts: input.parsed.counts,
    markdown: input.review,
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(jsonPayload, null, 2) + "\n", "utf8");
  await updateReportsIndex(reportsDir, meta);

  return meta;
}

export async function updateReportsIndex(
  reportsDir: string,
  entry: ReportMeta,
): Promise<void> {
  const indexPath = path.join(reportsDir, "index.json");
  let index: ReportsIndex = { updatedAt: new Date().toISOString(), reports: [] };

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    index = JSON.parse(raw) as ReportsIndex;
  } catch {
    // new index
  }

  const without = index.reports.filter((r) => r.id !== entry.id);
  without.unshift(entry);
  index.reports = without.slice(0, MAX_INDEX_ENTRIES);
  index.updatedAt = new Date().toISOString();

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
}

export function formatPrLinkComment(meta: ReportMeta): string {
  const c = meta.findingCounts;
  const counts = `C${c.critical} M${c.major} m${c.minor}`;
  return `<!-- review-code-ai -->\n🤖 **AI review** · \`${meta.verdict}\` · ${counts} · [full report](${meta.reportUrl})`;
}
