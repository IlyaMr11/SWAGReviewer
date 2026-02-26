import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";
import { asyncHandler } from "../../../platform/http/async-handler.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import type { SuggestionCategory } from "../../../shared/types/contracts.js";

const VALID_SCOPE: SuggestionCategory[] = ["security", "style", "bugs", "performance"];

export function createAnalysisJobRoutes() {
  const router = Router();

  router.post("/prs/:prId/analysis-jobs", asyncHandler(async (req, res) => {
    const prId = String(req.params.prId);
    const snapshotId = String(req.body?.snapshotId ?? "");
    const scope = parseScope(req.body?.scope);
    const files = Array.isArray(req.body?.files) ? req.body.files.map(String) : undefined;
    const maxComments = Number(req.body?.maxComments ?? 50);

    if (!snapshotId) {
      throw new HttpError(400, "validation_error", "snapshotId is required");
    }

    if (!Number.isFinite(maxComments) || maxComments <= 0) {
      throw new HttpError(400, "validation_error", "maxComments must be a positive number");
    }

    const job = await store.createAnalysisJob(prId, {
      snapshotId,
      scope,
      files,
      maxComments,
    });

    res.status(201).json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
    });
  }));

  router.get("/prs/:prId/analysis-jobs", (req, res) => {
    const page = store.listPrAnalysisJobs(String(req.params.prId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  router.get("/analysis-jobs/:jobId", (req, res) => {
    const job = store.getJob(String(req.params.jobId));
    res.status(200).json(job);
  });

  router.post("/analysis-jobs/:jobId/cancel", (req, res) => {
    const job = store.cancelJob(String(req.params.jobId));
    res.status(200).json(job);
  });

  router.get("/analysis-jobs/:jobId/results", (req, res) => {
    const page = store.listJobSuggestions(String(req.params.jobId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  router.get("/analysis-jobs/:jobId/events", (req, res) => {
    const page = store.listJobEvents(String(req.params.jobId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  return router;
}

function parseScope(raw: unknown): SuggestionCategory[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ["bugs"];
  }

  const parsed = raw.map((entry) => String(entry)) as SuggestionCategory[];
  const invalid = parsed.find((entry) => !VALID_SCOPE.includes(entry));
  if (invalid) {
    throw new HttpError(400, "validation_error", `Unsupported scope value: ${invalid}`);
  }

  return parsed;
}
