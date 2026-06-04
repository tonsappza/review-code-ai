export type ReviewMode = "diff" | "explore";

export type FindingSeverity = "critical" | "major" | "minor" | "suggestion";

export type Finding = {
  severity: FindingSeverity;
  title: string;
  file?: string;
  line?: number;
  issue?: string;
  suggestion?: string;
};

export type FindingCounts = Record<FindingSeverity, number>;

export type ParsedReview = {
  summary?: string;
  findings: Finding[];
  counts: FindingCounts;
  rawMarkdown: string;
};

export function emptyFindingCounts(): FindingCounts {
  return { critical: 0, major: 0, minor: 0, suggestion: 0 };
}

export function countFindings(findings: Finding[]): FindingCounts {
  const counts = emptyFindingCounts();
  for (const f of findings) {
    counts[f.severity] += 1;
  }
  return counts;
}

export type ReviewVerdict = "pass" | "warn" | "fail";

export function verdictFromCounts(counts: FindingCounts): ReviewVerdict {
  if (counts.critical > 0 || counts.major > 0) return "fail";
  if (counts.minor > 0) return "warn";
  return "pass";
}
