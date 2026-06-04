import { Agent, CursorAgentError } from "@cursor/sdk";
import { buildReviewPrompt } from "./prompts.js";
import type { PullRequestContext } from "./github.js";

export type ReviewInput = PullRequestContext & {
  diff: string;
  changedFiles: string[];
  apiKey: string;
  model?: string;
  cwd: string;
};

export type ReviewResult = {
  text: string;
  status: string;
};

export async function runAiReview(input: ReviewInput): Promise<ReviewResult> {
  const prompt = buildReviewPrompt({
    title: input.title,
    body: input.body,
    baseRef: input.baseRef,
    headRef: input.headRef,
    diff: input.diff,
    changedFiles: input.changedFiles,
  });

  try {
    const result = await Agent.prompt(prompt, {
      apiKey: input.apiKey,
      model: { id: input.model ?? "composer-2.5" },
      local: { cwd: input.cwd, settingSources: [] },
    });

    if (result.status === "error") {
      throw new Error(`Cursor agent run failed (status: error)`);
    }

    const text = (result.result ?? "").trim();
    if (!text) {
      throw new Error("Cursor agent returned an empty review");
    }

    return { text, status: result.status };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(
        `Cursor SDK startup failed: ${err.message} (retryable: ${err.isRetryable})`,
      );
    }
    throw err;
  }
}
