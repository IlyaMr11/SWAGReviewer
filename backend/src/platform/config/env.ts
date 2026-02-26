import path from "node:path";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  apiServiceToken: string | null;
  githubWebhookSecret: string | null;
  serveFrontend: boolean;
  frontendDistPath: string | null;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 4000);
  const serveFrontend = parseBoolean(process.env.SERVE_FRONTEND);
  const frontendDistPath = serveFrontend
    ? path.resolve(process.cwd(), process.env.FRONTEND_DIST_PATH ?? "../frontend/dist")
    : null;

  return {
    port: Number.isFinite(port) ? port : 4000,
    nodeEnv: process.env.NODE_ENV ?? "development",
    apiServiceToken: process.env.API_SERVICE_TOKEN ?? null,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? null,
    serveFrontend,
    frontendDistPath,
  };
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
