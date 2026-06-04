import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseFindings,
  parseReviewMarkdown,
  extractSummary,
} from "../src/core/parse-findings.js";
import { verdictFromCounts } from "../src/core/types.js";

const SAMPLE = `## Summary
Something important here.

## Findings

### [severity: major] — N+1 queries
- **File:** \`src/service.ts\` (line 42)
- **Issue:** Loop awaits DB per row
- **Suggestion:** Batch load

### [severity: suggestion] — Naming
- **File:** \`src/util.ts\`
- **Issue:** Unclear name
- **Suggestion:** Rename to parseId

## Test plan
- Run integration tests
`;

describe("parseFindings", () => {
  it("extracts structured findings", () => {
    const findings = parseFindings(SAMPLE);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].severity, "major");
    assert.equal(findings[0].title, "N+1 queries");
    assert.equal(findings[0].file, "src/service.ts");
    assert.equal(findings[0].line, 42);
    assert.equal(findings[1].severity, "suggestion");
  });

  it("parses full review with counts", () => {
    const parsed = parseReviewMarkdown(SAMPLE);
    assert.equal(parsed.counts.major, 1);
    assert.equal(parsed.counts.suggestion, 1);
    assert.ok(parsed.summary?.includes("important"));
    assert.equal(verdictFromCounts(parsed.counts), "fail");
  });

  it("returns pass verdict when no major/critical", () => {
    const parsed = parseReviewMarkdown(`## Summary\nOk\n\n## Findings\n\n### [severity: minor] — nit\n- **Issue:** x\n`);
    assert.equal(verdictFromCounts(parsed.counts), "warn");
  });
});

describe("extractSummary", () => {
  it("reads summary section", () => {
    assert.equal(extractSummary(SAMPLE), "Something important here.");
  });
});
