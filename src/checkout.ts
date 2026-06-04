import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type PrHeadInfo = {
  headOwner: string;
  headRepo: string;
  headRef: string;
};

export function getGhToken(): string {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv && fromEnv !== "ghp_your_token_here") return fromEnv;

  try {
    return execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("Run gh auth login or set GITHUB_TOKEN in .env");
  }
}

export function fetchPrHead(
  repository: string,
  prNumber: number,
): PrHeadInfo {
  const json = execFileSync(
    "gh",
    [
      "pr",
      "view",
      String(prNumber),
      "--repo",
      repository,
      "--json",
      "headRefName,headRepository,headRepositoryOwner",
    ],
    { encoding: "utf8" },
  );

  const pr = JSON.parse(json) as {
    headRefName: string;
    headRepository?: { name?: string } | null;
    headRepositoryOwner?: { login?: string } | null;
  };

  const [owner, repo] = repository.split("/");
  return {
    headOwner: pr.headRepositoryOwner?.login ?? owner ?? "",
    headRepo: pr.headRepository?.name ?? repo ?? "",
    headRef: pr.headRefName,
  };
}

export function clonePrHead(input: {
  repository: string;
  prNumber: number;
  targetDir: string;
}): string {
  const head = fetchPrHead(input.repository, input.prNumber);
  const cloneUrl = `https://github.com/${head.headOwner}/${head.headRepo}.git`;

  if (fs.existsSync(input.targetDir)) {
    fs.rmSync(input.targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(input.targetDir), { recursive: true });

  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", head.headRef, cloneUrl, input.targetDir],
    { stdio: "inherit" },
  );

  return input.targetDir;
}

export function defaultReviewTargetDir(projectRoot: string): string {
  return path.join(projectRoot, ".review-target");
}

export function isManagedReviewTarget(
  targetDir: string,
  projectRoot: string,
): boolean {
  const resolved = path.resolve(targetDir);
  const managed = path.resolve(defaultReviewTargetDir(projectRoot));
  return resolved === managed || resolved.startsWith(managed + path.sep);
}

export function shouldKeepReviewTarget(): boolean {
  const v = process.env.KEEP_REVIEW_TARGET?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function cleanupReviewTarget(
  targetDir: string,
  onLog?: (message: string) => void,
): boolean {
  if (shouldKeepReviewTarget()) {
    onLog?.(`Keeping clone at ${targetDir} (KEEP_REVIEW_TARGET)`);
    return false;
  }
  if (!fs.existsSync(targetDir)) return false;

  const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 300 };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.rmSync(targetDir, opts);
      onLog?.(`Removed clone ${targetDir}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 3) {
        onLog?.(
          `Could not remove clone ${targetDir}: ${msg} — close editors using this folder and delete manually`,
        );
        return false;
      }
      onLog?.(`Cleanup retry ${attempt}/3…`);
    }
  }
  return false;
}
