import { Agent, CursorAgentError } from "@cursor/sdk";
import type { PrFileChange } from "../github.js";
import {
  buildChunksFromFileChanges,
  packChunks,
  shouldUseChunkedReview,
} from "./diff-chunks.js";
import {
  formatPriorFindingsForPrompt,
  loadPriorFindings,
} from "./prior-report.js";
import { mergeParsedReviews } from "./merge-reviews.js";
import { buildReviewPrompt } from "./prompts.js";
import { parseReviewMarkdown } from "./parse-findings.js";
import type { ReviewMode } from "./types.js";

export type RunAiReviewInput = {
  mode: ReviewMode;
  reviewCwd: string;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  diff: string;
  changedFiles: string[];
  apiKey: string;
  model?: string;
  fileChanges?: PrFileChange[];
  reportsDir?: string;
  repository?: string;
  prNumber?: number;
  incremental?: boolean;
  onLog?: (message: string) => void;
};

async function promptReview(
  input: RunAiReviewInput,
  prompt: string,
): Promise<string> {
  const result = await Agent.prompt(prompt, {
    apiKey: input.apiKey,
    model: { id: input.model ?? "composer-2.5" },
    local: { cwd: input.reviewCwd, settingSources: [] },
  });

  if (result.status === "error") {
    throw new Error("Cursor agent run failed (status: error)");
  }

  const text = (result.result ?? "").trim();
  if (!text) {
    throw new Error("Cursor agent returned an empty review");
  }
  return text;
}

export async function runAiReview(input: RunAiReviewInput): Promise<string> {
  const log = (m: string) => input.onLog?.(m);

  let priorText: string | undefined;
  if (
    input.incremental &&
    input.reportsDir &&
    input.repository &&
    input.prNumber
  ) {
    const [owner, repo] = input.repository.split("/");
    const prior = await loadPriorFindings({
      reportsDir: input.reportsDir,
      owner: owner!,
      repo: repo!,
      pr: input.prNumber,
    });
    if (prior?.length) {
      priorText = formatPriorFindingsForPrompt(prior);
      log(`Incremental: ${prior.length} prior finding(s) loaded`);
    }
  }

  const useChunked =
    input.fileChanges &&
    shouldUseChunkedReview(input.diff.length, input.changedFiles.length);

  if (!useChunked || !input.fileChanges?.length) {
    log("Review strategy: single pass");
    const prompt = buildReviewPrompt({
      mode: input.mode,
      reviewCwd: input.reviewCwd,
      title: input.title,
      body: input.body,
      baseRef: input.baseRef,
      headRef: input.headRef,
      diff: input.diff,
      changedFiles: input.changedFiles,
      priorFindings: priorText,
    });
    try {
      return await promptReview(input, prompt);
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new Error(
          `Cursor SDK startup failed: ${err.message} (retryable: ${err.isRetryable})`,
        );
      }
      throw err;
    }
  }

  const { chunks: rawChunks, skipped } = buildChunksFromFileChanges(
    input.fileChanges,
  );
  const chunks = packChunks(rawChunks);
  log(
    `Review strategy: chunked — ${chunks.length} chunk(s), ${skipped.length} file(s) skipped (no patch)`,
  );

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    log(`Chunk ${i + 1}/${chunks.length}: ${chunk.files.join(", ")}`);
    const prompt = buildReviewPrompt({
      mode: input.mode,
      reviewCwd: input.reviewCwd,
      title: input.title,
      body: input.body,
      baseRef: input.baseRef,
      headRef: input.headRef,
      diff: chunk.diff,
      changedFiles: chunk.files,
      priorFindings: i === 0 ? priorText : undefined,
      chunkLabel: `Chunk ${i + 1}/${chunks.length} — ${chunk.files.join(", ")}`,
    });
    try {
      const text = await promptReview(input, prompt);
      parts.push(parseReviewMarkdown(text));
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new Error(
          `Cursor SDK startup failed: ${err.message} (retryable: ${err.isRetryable})`,
        );
      }
      throw err;
    }
  }

  const merged = mergeParsedReviews({
    parts,
    chunkCount: chunks.length,
    skipped,
    incremental: input.incremental,
  });

  return merged.rawMarkdown;
}
