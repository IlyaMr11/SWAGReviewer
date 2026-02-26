import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";
import { HttpError } from "../../../shared/errors/http-error.js";

interface GithubRoutesOptions {
  webhookSecret: string | null;
}

export function createGithubRoutes(options: GithubRoutesOptions) {
  const router = Router();

  router.post("/webhooks/github", (req, res) => {
    const deliveryId = req.header("x-github-delivery") ?? "unknown";
    const event = req.header("x-github-event") ?? "unknown";

    if (options.webhookSecret) {
      const signature = req.header("x-hub-signature-256");
      if (!signature) {
        throw new HttpError(401, "signature_missing", "Missing x-hub-signature-256 header");
      }

      const raw = JSON.stringify(req.body ?? {});
      const digest = `sha256=${createHmac("sha256", options.webhookSecret).update(raw).digest("hex")}`;

      if (!safeCompare(signature, digest)) {
        throw new HttpError(401, "signature_invalid", "Invalid webhook signature");
      }
    }

    res.status(202).json({
      received: true,
      event,
      deliveryId,
      processedAt: new Date().toISOString(),
    });
  });

  router.post("/integrations/github/install", (req, res) => {
    const installationId = Number(req.body?.installation_id);
    const accountLogin = String(req.body?.account_login ?? "unknown-org");

    if (!Number.isFinite(installationId) || installationId <= 0) {
      throw new HttpError(400, "validation_error", "installation_id must be a positive number");
    }

    const installation = store.upsertGithubInstallation(installationId, accountLogin);

    res.status(201).json({
      installation: {
        id: installation.id,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        createdAt: installation.createdAt,
        updatedAt: installation.updatedAt,
      },
    });
  });

  return router;
}

function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
