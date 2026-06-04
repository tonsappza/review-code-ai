import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInlineComments,
  isLineInPatch,
  meetsSeverity,
} from "../src/core/inline-comments.js";

const PATCH = `@@ -1,3 +1,4 @@
 line1
-old
+new line
+added
 context
`;

describe("isLineInPatch", () => {
  it("finds line on RIGHT side", () => {
    assert.equal(isLineInPatch(PATCH, 3), true);
  });

  it("rejects line not in hunk", () => {
    assert.equal(isLineInPatch(PATCH, 99), false);
  });
});

describe("buildInlineComments", () => {
  it("filters by severity and patch", () => {
    const files = new Map([["src/a.ts", PATCH]]);
    const comments = buildInlineComments({
      findings: [
        {
          severity: "major",
          title: "Bug",
          file: "src/a.ts",
          line: 3,
          issue: "bad",
        },
        {
          severity: "suggestion",
          title: "Nit",
          file: "src/a.ts",
          line: 3,
        },
        {
          severity: "critical",
          title: "No line",
          file: "src/b.ts",
          line: 1,
        },
      ],
      changedFiles: files,
      minSeverity: "major",
    });
    assert.equal(comments.length, 1);
    assert.equal(comments[0].severity, "major");
  });
});

describe("meetsSeverity", () => {
  it("ranks severities", () => {
    assert.equal(meetsSeverity("critical", "major"), true);
    assert.equal(meetsSeverity("suggestion", "major"), false);
  });
});
