import fs from "node:fs";

export type GitHubAppConfig = {
  appId: number;
  privateKey: string;
  webhookSecret: string;
};

export function loadGitHubAppConfig(): GitHubAppConfig | null {
  const appIdRaw = process.env.GITHUB_APP_ID?.trim();
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  if (!appIdRaw || !webhookSecret) return null;

  const appId = Number.parseInt(appIdRaw, 10);
  if (!Number.isFinite(appId)) {
    throw new Error("GITHUB_APP_ID must be a number");
  }

  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  if (!privateKey && keyPath) {
    privateKey = fs.readFileSync(keyPath, "utf8");
  }
  if (!privateKey) {
    throw new Error(
      "Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH",
    );
  }

  return {
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    webhookSecret,
  };
}

export function isGitHubAppEnabled(): boolean {
  try {
    return loadGitHubAppConfig() !== null;
  } catch {
    return false;
  }
}
