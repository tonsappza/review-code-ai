import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { GitHubAppConfig } from "./config.js";

export function createAppOctokit(config: GitHubAppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
    },
  });
}

export async function getInstallationToken(
  config: GitHubAppConfig,
  installationId: number,
): Promise<string> {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
  });

  const result = await auth({
    type: "installation",
    installationId,
  });

  if (!result.token) {
    throw new Error("Failed to obtain installation token");
  }
  return result.token;
}
