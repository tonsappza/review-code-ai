import type { Finding, FindingSeverity, ParsedReview } from "./types.js";
import { countFindings, emptyFindingCounts } from "./types.js";

const SEVERITIES: FindingSeverity[] = [
  "critical",
  "major",
  "minor",
  "suggestion",
];

const HEADER_RE =
  /^###\s*\[severity:\s*(critical|major|minor|suggestion)\]\s*[—–-]\s*(.+)\s*$/gim;

function parseField(block: string, label: string): string | undefined {
  const re = new RegExp(
    `^-\\s*\\*\\*${label}:\\*\\*\\s*(.+)$`,
    "im",
  );
  const m = block.match(re);
  return m?.[1]?.trim();
}

function parseFileLine(
  fileField: string | undefined,
): { file?: string; line?: number } {
  if (!fileField) return {};
  const pathMatch = fileField.match(/`([^`]+)`/);
  const file = pathMatch?.[1];
  const lineMatch = fileField.match(/\(line\s+(\d+)\)/i);
  const line = lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined;
  return { file, line: Number.isFinite(line) ? line : undefined };
}

export function parseFindings(markdown: string): Finding[] {
  const findings: Finding[] = [];
  const headers = [...markdown.matchAll(HEADER_RE)];

  for (let i = 0; i < headers.length; i++) {
    const match = headers[i];
    const severity = match[1] as FindingSeverity;
    const title = match[2].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < headers.length
        ? (headers[i + 1].index ?? markdown.length)
        : markdown.length;
    const block = markdown.slice(start, end).trim();

    const fileField = parseField(block, "File");
    const { file, line } = parseFileLine(fileField);

    findings.push({
      severity,
      title,
      file,
      line,
      issue: parseField(block, "Issue"),
      suggestion: parseField(block, "Suggestion"),
    });
  }

  return findings;
}

export function extractSummary(markdown: string): string | undefined {
  const section = markdown.match(
    /##\s*Summary\s*\n+([\s\S]*?)(?=\n##\s|\n###\s|$)/i,
  );
  return section?.[1]?.trim();
}

export function parseReviewMarkdown(markdown: string): ParsedReview {
  const findings = parseFindings(markdown);
  return {
    summary: extractSummary(markdown),
    findings,
    counts: countFindings(findings),
    rawMarkdown: markdown,
  };
}

export function isValidSeverity(value: string): value is FindingSeverity {
  return (SEVERITIES as string[]).includes(value);
}

export { emptyFindingCounts };
