import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type PrHeadInfo = {
  headOwner: string;
  headRepo: string;
  headRef: string;
};

export function getGhToken(): string {
  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  } catch {
    const fromEnv = process.env.GITHUB_TOKEN?.trim();
    if (fromEnv && fromEnv !== "ghp_your_token_here") return fromEnv;
    throw new Error("Run gh auth login or set GITHUB_TOKEN");
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
