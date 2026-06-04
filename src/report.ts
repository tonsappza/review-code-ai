import fs from "node:fs/promises";
import path from "node:path";
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
  };
  review: string;
}): string {
  const id = reportId(input.meta.owner, input.meta.repo, input.meta.pr);
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
    "---",
  ].join("\n");

  return `${frontmatter}\n\n# AI Code Review\n\n**${input.meta.title}**\n\n- PR: [#${input.meta.pr}](${input.meta.prUrl})\n- Reviewed: ${input.meta.reviewedAt}\n- Files changed: ${input.meta.filesChanged}\n\n---\n\n${input.review.trim()}`;
}

export async function saveReport(input: {
  reportsDir: string;
  pr: PullRequestContext;
  prUrl: string;
  review: string;
  model?: string;
  filesChanged: number;
}): Promise<ReportMeta> {
  const reportsDir = resolveReportsDir(input.reportsDir);
  const rel = reportRelativePath(input.pr.owner, input.pr.repo, input.pr.number);
  const filePath = path.join(reportsDir, rel);
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
    },
    review: input.review,
  });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");
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
  return `<!-- review-code-ai -->\n🤖 **AI review saved** in [review-code-ai](${meta.reportUrl})\n\n[Open full report →](${meta.reportUrl})`;
}
