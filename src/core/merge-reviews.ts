import type { Finding, ParsedReview } from "./types.js";
import { countFindings } from "./types.js";
import type { DiffChunk } from "./diff-chunks.js";

export function mergeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const f of findings) {
    const key = `${f.severity}|${f.file ?? ""}|${f.line ?? ""}|${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }

  return out;
}

export function buildMergedMarkdown(input: {
  summaries: string[];
  findings: Finding[];
  chunkCount: number;
  skippedFiles: string[];
  incremental?: boolean;
}): string {
  const counts = countFindings(input.findings);
  const summaryParts = input.summaries.filter(Boolean);
  const summary =
    summaryParts.length > 0
      ? summaryParts.join("\n\n")
      : `Reviewed ${input.chunkCount} chunk(s). Findings: critical ${counts.critical}, major ${counts.major}, minor ${counts.minor}, suggestion ${counts.suggestion}.`;

  const findingsSection =
    input.findings.length > 0
      ? input.findings
          .map((f) => {
            const loc = f.file
              ? `\n- **File:** \`${f.file}\`${f.line ? ` (line ${f.line})` : ""}`
              : "";
            return `### [severity: ${f.severity}] — ${f.title}${loc}\n- **Issue:** ${f.issue ?? "(see title)"}\n${f.suggestion ? `- **Suggestion:** ${f.suggestion}` : ""}`;
          })
          .join("\n\n")
      : "No blocking issues found.";

  const skippedNote =
    input.skippedFiles.length > 0
      ? `\n\n_Files not reviewed (no patch): ${input.skippedFiles.join(", ")}_`
      : "";

  const incrementalNote = input.incremental
    ? "\n\n_Incremental review: focused on new issues vs previous report._"
    : "";

  return `## Summary
${summary}
${incrementalNote}

## Findings
${findingsSection}
${skippedNote}

## Test plan
- Re-run affected unit/integration tests for changed modules
- Verify fixes for any critical/major findings before merge`;
}

export function mergeParsedReviews(input: {
  parts: ParsedReview[];
  chunkCount: number;
  skipped: DiffChunk[];
  incremental?: boolean;
}): ParsedReview {
  const findings = mergeFindings(input.parts.flatMap((p) => p.findings));
  const summaries = input.parts.map((p) => p.summary).filter(Boolean) as string[];
  const skippedFiles = input.skipped.flatMap((s) => s.files);

  const rawMarkdown = buildMergedMarkdown({
    summaries,
    findings,
    chunkCount: input.chunkCount,
    skippedFiles,
    incremental: input.incremental,
  });

  return {
    summary: summaries[0],
    findings,
    counts: countFindings(findings),
    rawMarkdown,
  };
}
