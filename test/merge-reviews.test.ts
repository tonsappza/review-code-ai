import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeParsedReviews } from "../src/core/merge-reviews.js";

describe("mergeParsedReviews", () => {
  it("dedupes findings and builds markdown", () => {
    const merged = mergeParsedReviews({
      parts: [
        {
          summary: "Part A",
          findings: [
            {
              severity: "major",
              title: "Bug",
              file: "a.ts",
              line: 1,
            },
          ],
          counts: { critical: 0, major: 1, minor: 0, suggestion: 0 },
          rawMarkdown: "",
        },
        {
          summary: "Part B",
          findings: [
            {
              severity: "major",
              title: "Bug",
              file: "a.ts",
              line: 1,
            },
            {
              severity: "minor",
              title: "Nit",
              file: "b.ts",
            },
          ],
          counts: { critical: 0, major: 1, minor: 1, suggestion: 0 },
          rawMarkdown: "",
        },
      ],
      chunkCount: 2,
      skipped: [],
    });

    assert.equal(merged.findings.length, 2);
    assert.match(merged.rawMarkdown, /## Summary/);
    assert.match(merged.rawMarkdown, /Bug/);
  });
});
