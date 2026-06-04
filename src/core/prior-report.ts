import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "./types.js";
import { reportJsonRelativePath } from "../report.js";

export async function loadPriorFindings(input: {
  reportsDir: string;
  owner: string;
  repo: string;
  pr: number;
}): Promise<Finding[] | undefined> {
  const rel = reportJsonRelativePath(input.owner, input.repo, input.pr);
  const filePath = path.join(input.reportsDir, rel);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as { findings?: Finding[] };
    if (!Array.isArray(data.findings) || data.findings.length === 0) {
      return undefined;
    }
    return data.findings;
  } catch {
    return undefined;
  }
}

export function formatPriorFindingsForPrompt(findings: Finding[]): string {
  const top = findings.slice(0, 15);
  const lines = top.map((f) => {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
    return `- [${f.severity}] ${f.title}${loc ? ` (${loc})` : ""}`;
  });
  const more =
    findings.length > top.length
      ? `\n- ... and ${findings.length - top.length} more`
      : "";
  return `${lines.join("\n")}${more}`;
}
