import type { ReviewMode } from "./types.js";

const REVIEW_SYSTEM = `You are a senior software engineer performing a pull request code review.

Focus on:
- Correctness bugs and logic errors
- Security issues (injection, auth, secrets, unsafe defaults)
- Performance regressions
- Missing error handling
- Test gaps for changed behavior
- Breaking API or contract changes

Ignore:
- Pure formatting unless it hides a real issue
- Nitpicks that do not affect correctness or maintainability

Respond in GitHub-flavored Markdown with this structure:

## Summary
(2-4 sentences)

## Findings
For each issue use:
### [severity: critical|major|minor|suggestion] — short title
- **File:** \`path\` (line N if known)
- **Issue:** what is wrong
- **Suggestion:** concrete fix

If there are no meaningful issues, write "No blocking issues found." under Findings.

## Test plan
Bullet list of what the author should verify before merge.`;

const EXPLORE_ADDENDUM = `
You have access to the repository checkout at the review working directory.
Before finalizing findings:
1. Read the changed files and closely related code (callers, types, tests).
2. Use repo context to catch cross-file bugs, missing tests, and contract breaks that the diff alone may not show.
3. Still cite **File:** paths that exist in the repo; do not invent files.
4. Prefer line numbers you can verify from the codebase or diff.`;

function priorFindingsBlock(priorFindings?: string): string {
  if (!priorFindings?.trim()) return "";
  return `
## Previous review (incremental)
Report only **new** issues or issues still not fixed. Do not repeat prior items unless still broken.

${priorFindings}
`;
}

export function buildReviewPrompt(input: {
  mode: ReviewMode;
  reviewCwd: string;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  diff: string;
  changedFiles: string[];
  priorFindings?: string;
  chunkLabel?: string;
}): string {
  const filesList =
    input.changedFiles.length > 0
      ? input.changedFiles.map((f) => `- ${f}`).join("\n")
      : "(none listed)";

  const modeBlock =
    input.mode === "explore"
      ? `${EXPLORE_ADDENDUM}\n\n**Review working directory:** \`${input.reviewCwd}\`\n`
      : "Review primarily from the diff below. Only cite files and lines present in the diff.\n";

  return `${REVIEW_SYSTEM}

---

${modeBlock}

## Pull request
**Title:** ${input.title}
**Base → Head:** ${input.baseRef} → ${input.headRef}

**Description:**
${input.body.trim() || "(no description)"}

**Changed files:**
${filesList}
${input.chunkLabel ? `\n**Scope:** ${input.chunkLabel}\n` : ""}
${priorFindingsBlock(input.priorFindings)}
**Diff (unified):**
\`\`\`diff
${input.diff}
\`\`\`

Produce the markdown review now.`;
}
