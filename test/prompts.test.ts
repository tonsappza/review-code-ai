import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewPrompt } from "../src/core/prompts.js";

describe("buildReviewPrompt", () => {
  it("includes explore instructions in explore mode", () => {
    const prompt = buildReviewPrompt({
      mode: "explore",
      reviewCwd: "/tmp/repo",
      title: "Test",
      body: "",
      baseRef: "main",
      headRef: "feature",
      diff: "+line",
      changedFiles: ["a.ts"],
    });
    assert.match(prompt, /repository checkout/i);
    assert.match(prompt, /\/tmp\/repo/);
  });

  it("limits diff mode to diff context", () => {
    const prompt = buildReviewPrompt({
      mode: "diff",
      reviewCwd: "/tmp/repo",
      title: "Test",
      body: "",
      baseRef: "main",
      headRef: "feature",
      diff: "+line",
      changedFiles: ["a.ts"],
    });
    assert.match(prompt, /primarily from the diff/i);
  });
});
