import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import type { FeedbackVoteValue } from "../../../shared/types/contracts.js";

export function createFeedbackRoutes() {
  const router = Router();

  router.put("/comments/:commentId/feedback", (req, res) => {
    const commentId = String(req.params.commentId);
    const vote = String(req.body?.vote ?? "") as FeedbackVoteValue;

    if (vote !== "up" && vote !== "down") {
      throw new HttpError(400, "validation_error", "vote must be up or down");
    }

    const userId = String(req.body?.userId ?? req.header("x-user-id") ?? "anonymous");
    const reason = req.body?.reason ? String(req.body.reason) : undefined;

    const feedback = store.upsertFeedback(commentId, userId, vote, reason);

    res.status(200).json(feedback);
  });

  router.get("/comments/:commentId/feedback", (req, res) => {
    const result = store.getCommentFeedback(String(req.params.commentId));

    res.status(200).json({
      comment: result.comment,
      votes: result.votes,
      totals: result.totals,
    });
  });

  router.get("/prs/:prId/feedback-summary", (req, res) => {
    const summary = store.getPrFeedbackSummary(String(req.params.prId));
    res.status(200).json(summary);
  });

  return router;
}
