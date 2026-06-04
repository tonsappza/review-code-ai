import { config as loadDotenv } from "dotenv";
import http from "node:http";
import {
  getWebhookJob,
  handleGitHubWebhook,
  listWebhookJobs,
} from "./github-app/handler.js";
import { loadGitHubAppConfig } from "./github-app/config.js";
import { verifyWebhookSignature } from "./github-app/verify.js";

loadDotenv();

const PORT = Number.parseInt(process.env.WEBHOOK_PORT ?? "4040", 10);

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const appConfig = loadGitHubAppConfig();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        githubApp: Boolean(appConfig),
        cursorApiKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/github/jobs") {
      json(res, 200, { jobs: listWebhookJobs() });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/github/jobs/")) {
      const id = url.pathname.slice("/api/github/jobs/".length);
      const job = getWebhookJob(id);
      if (!job) {
        json(res, 404, { error: "job not found" });
        return;
      }
      json(res, 200, job);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/github/webhook") {
      if (!appConfig) {
        json(res, 503, { error: "GitHub App not configured in .env" });
        return;
      }

      const raw = await readBody(req);
      const payloadStr = raw.toString("utf8");
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      const event = req.headers["x-github-event"] as string | undefined;

      if (
        !verifyWebhookSignature({
          secret: appConfig.webhookSecret,
          payload: payloadStr,
          signatureHeader: sig,
        })
      ) {
        json(res, 401, { error: "invalid webhook signature" });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(payloadStr);
      } catch {
        json(res, 400, { error: "invalid JSON" });
        return;
      }

      const result = await handleGitHubWebhook(
        appConfig,
        event ?? "unknown",
        body,
      );
      json(res, 202, result);
      return;
    }

    res.writeHead(404).end("Not found");
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  GitHub App webhook → http://127.0.0.1:${PORT}/api/github/webhook`);
  if (!appConfig) {
    console.log("  ⚠ GITHUB_APP_* not set — configure .env (see docs/GITHUB_APP.md)\n");
  } else {
    console.log("  App ID:", appConfig.appId);
    console.log("  Jobs:     http://127.0.0.1:" + PORT + "/api/github/jobs\n");
  }
});
