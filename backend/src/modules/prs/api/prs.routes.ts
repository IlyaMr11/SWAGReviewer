import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import type { PublishMode } from "../../../shared/types/contracts.js";

export function createPrRoutes() {
  const router = Router();

  router.post("/repos/:repoId/prs/:prNumber/sync", (req, res) => {
    const repoId = String(req.params.repoId);
    const prNumber = Number(req.params.prNumber);

    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      throw new HttpError(400, "validation_error", "prNumber must be a positive integer");
    }

    const syncResult = store.syncPullRequest(repoId, prNumber, req.body);

    res.status(200).json({
      prId: syncResult.pr.id,
      snapshotId: syncResult.snapshot.id,
      counts: syncResult.counts,
      idempotent: syncResult.idempotent,
    });
  });

  router.get("/prs/:prId", (req, res) => {
    const pr = store.getPr(String(req.params.prId));
    const latestSnapshot = pr.latestSnapshotId ? store.getSnapshot(pr.latestSnapshotId).snapshot : null;

    res.status(200).json({
      pr,
      latestSnapshot,
    });
  });

  router.get("/prs/:prId/files", (req, res) => {
    const page = store.listPrFiles(String(req.params.prId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  router.get("/prs/:prId/diff", (req, res) => {
    const filePath = typeof req.query.file === "string" ? req.query.file : null;
    const items = store.getPrDiff(String(req.params.prId), filePath);

    res.status(200).json({
      items,
      count: items.length,
    });
  });

  router.get("/prs/:prId/snapshots", (req, res) => {
    const snapshots = store.listPrSnapshots(String(req.params.prId));

    res.status(200).json({
      items: snapshots,
      count: snapshots.length,
    });
  });

  router.get("/snapshots/:snapshotId", (req, res) => {
    const result = store.getSnapshot(String(req.params.snapshotId));

    res.status(200).json({
      snapshot: result.snapshot,
      files: result.files,
      counts: {
        files: result.files.length,
        additions: result.snapshot.additions,
        deletions: result.snapshot.deletions,
      },
    });
  });

  router.post("/prs/:prId/publish", (req, res) => {
    const prId = String(req.params.prId);
    const jobId = String(req.body?.jobId ?? "");
    const mode = String(req.body?.mode ?? "review_comments") as PublishMode;
    const dryRun = Boolean(req.body?.dryRun);

    if (!jobId) {
      throw new HttpError(400, "validation_error", "jobId is required");
    }

    if (mode !== "review_comments" && mode !== "issue_comments") {
      throw new HttpError(400, "validation_error", "mode must be review_comments or issue_comments");
    }

    const publishResult = store.publish(prId, jobId, mode, dryRun);

    res.status(200).json({
      publishRunId: publishResult.publishRunId,
      publishedCount: publishResult.publishedCount,
      errors: publishResult.errors,
      comments: publishResult.comments,
      idempotent: publishResult.idempotent,
    });
  });

  router.get("/prs/:prId/comments", (req, res) => {
    const page = store.listPrComments(String(req.params.prId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  return router;
}
