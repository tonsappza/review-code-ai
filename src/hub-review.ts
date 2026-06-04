import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupReviewTarget,
  clonePrHead,
  defaultReviewTargetDir,
  isManagedReviewTarget,
} from "./checkout.js";
import { parseBool, resolveReviewMode } from "./config.js";
import { runReviewPipeline } from "./core/pipeline.js";
import type { GithubFeedbackOptions } from "./github-feedback.js";
import { resolveReportsDir, type ReportMeta } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HUB_ROOT = path.resolve(__dirname, "..");

export type HubReviewInput = {
  repository: string;
  prNumber: number;
  token: string;
  apiKey: string;
  model?: string;
  mode?: string;
  incremental?: boolean;
  githubFeedback?: GithubFeedbackOptions;
  onLog?: (message: string) => void;
};

export type HubReviewResult = {
  meta: ReportMeta;
};

export async function runHubReview(
  input: HubReviewInput,
): Promise<HubReviewResult> {
  const log = (m: string) => input.onLog?.(m);
  const targetDir = defaultReviewTargetDir(HUB_ROOT);
  const reportsDir = resolveReportsDir();
  const shouldCleanup = isManagedReviewTarget(targetDir, HUB_ROOT);

  log(`Review ${input.repository}#${input.prNumber}`);

  try {
    log(`Cloning PR head to ${targetDir}…`);
    clonePrHead({
      repository: input.repository,
      prNumber: input.prNumber,
      targetDir,
    });

    const { meta } = await runReviewPipeline({
      token: input.token,
      repository: input.repository,
      prNumber: input.prNumber,
      apiKey: input.apiKey,
      model: input.model,
      mode: resolveReviewMode(input.mode),
      reviewCwd: targetDir,
      reportsDir,
      incremental: input.incremental,
      githubFeedback: input.githubFeedback,
      onLog: input.onLog,
    });

    if (parseBool(process.env.HUB_AUTO_COMMIT, false)) {
      try {
        commitReportsToHub(meta, input.repository, input.prNumber);
        log("Committed report to hub repository");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Hub commit skipped/failed: ${msg}`);
      }
    }

    return { meta };
  } finally {
    if (shouldCleanup) {
      cleanupReviewTarget(targetDir, log);
    }
  }
}

function commitReportsToHub(
  meta: ReportMeta,
  repository: string,
  prNumber: number,
): void {
  execSync("git add reports/", { cwd: HUB_ROOT, stdio: "pipe" });
  const msg = `report: ${repository}#${prNumber}`;
  try {
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
      cwd: HUB_ROOT,
      stdio: "pipe",
    });
    execSync("git push", { cwd: HUB_ROOT, stdio: "pipe" });
  } catch {
    // nothing to commit
  }
}
