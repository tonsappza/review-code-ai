import type { Finding, FindingSeverity } from "./types.js";

export type InlineReviewComment = {
  path: string;
  line: number;
  body: string;
  severity: FindingSeverity;
  title: string;
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};

export function parseMinSeverity(value?: string): FindingSeverity {
  const v = value?.trim().toLowerCase();
  if (v === "critical" || v === "major" || v === "minor" || v === "suggestion") {
    return v;
  }
  return "major";
}

export function meetsSeverity(
  finding: FindingSeverity,
  minimum: FindingSeverity,
): boolean {
  return SEVERITY_RANK[finding] >= SEVERITY_RANK[minimum];
}

export function formatInlineCommentBody(f: Finding): string {
  const parts = [
    `**[${f.severity}]** ${f.title}`,
    "",
    f.issue ? f.issue : "",
    f.suggestion ? `\n**Suggestion:** ${f.suggestion}` : "",
  ];
  return parts.filter(Boolean).join("\n").trim();
}

/** Walk unified patch hunks; return true if `line` exists on the post-change (RIGHT) side. */
export function isLineInPatch(patch: string, line: number): boolean {
  let curLine = 0;
  for (const row of patch.split("\n")) {
    if (row.startsWith("@@")) {
      const m = row.match(/\+(\d+)(?:,(\d+))?/);
      curLine = m ? Number.parseInt(m[1], 10) : 0;
      continue;
    }
    if (row.startsWith("\\")) continue;
    if (row.startsWith("-")) continue;
    if (row.startsWith("+")) {
      if (curLine === line) return true;
      curLine += 1;
      continue;
    }
    if (row.startsWith(" ")) {
      if (curLine === line) return true;
      curLine += 1;
    }
  }
  return false;
}

export function buildInlineComments(input: {
  findings: Finding[];
  changedFiles: Map<string, string | undefined>;
  minSeverity?: FindingSeverity;
  maxComments?: number;
}): InlineReviewComment[] {
  const min = input.minSeverity ?? "major";
  const max = input.maxComments ?? 25;
  const out: InlineReviewComment[] = [];

  for (const f of input.findings) {
    if (!meetsSeverity(f.severity, min)) continue;
    if (!f.file || !f.line || f.line < 1) continue;

    const normalized = f.file.replace(/\\/g, "/");
    const patch = input.changedFiles.get(normalized);
    if (patch === undefined) continue;
    if (!patch || !isLineInPatch(patch, f.line)) continue;

    out.push({
      path: normalized,
      line: f.line,
      body: formatInlineCommentBody(f),
      severity: f.severity,
      title: f.title,
    });
    if (out.length >= max) break;
  }

  return out;
}
