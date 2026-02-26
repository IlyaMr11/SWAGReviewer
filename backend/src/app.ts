import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApiRouter } from "./platform/http/router.js";
import { serviceTokenAuth } from "./platform/http/middleware/auth.js";
import { errorHandler, notFoundHandler } from "./platform/http/middleware/error-handler.js";

export interface AppOptions {
  apiServiceToken: string | null;
  githubWebhookSecret: string | null;
  serveFrontend: boolean;
  frontendDistPath: string | null;
}

export function createApp(options: AppOptions) {
  const app = express();

  // Allow frontend running on a different origin (e.g. Vite dev server).
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send();
      return;
    }

    next();
  });

  app.use(express.json({ limit: "2mb" }));
  app.use(serviceTokenAuth(options.apiServiceToken));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/readyz", (_req, res) => {
    res.status(200).json({ status: "ready" });
  });

  const indexFile = resolveFrontendIndex(options.frontendDistPath);

  if (options.serveFrontend && indexFile) {
    app.use(express.static(path.dirname(indexFile)));
  }

  app.use(createApiRouter({ githubWebhookSecret: options.githubWebhookSecret }));

  if (options.serveFrontend && indexFile) {
    app.get("*", (req, res, next) => {
      if (isApiPath(req.path)) {
        next();
        return;
      }

      res.sendFile(indexFile, (error) => {
        if (error) {
          next();
        }
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function resolveFrontendIndex(frontendDistPath: string | null): string | null {
  if (!frontendDistPath) {
    return null;
  }

  const indexFile = path.join(frontendDistPath, "index.html");
  return fs.existsSync(indexFile) ? indexFile : null;
}

function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/healthz") ||
    pathname.startsWith("/readyz") ||
    pathname.startsWith("/webhooks") ||
    pathname.startsWith("/integrations") ||
    pathname.startsWith("/github/session") ||
    pathname.startsWith("/repos") ||
    pathname.startsWith("/prs") ||
    pathname.startsWith("/snapshots") ||
    pathname.startsWith("/analysis-jobs") ||
    pathname.startsWith("/comments")
  );
}
