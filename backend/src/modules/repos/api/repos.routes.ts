import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";

export function createReposRoutes() {
  const router = Router();

  router.get("/repos", (req, res) => {
    const page = store.listRepos(req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  router.get("/repos/:repoId/runs", (req, res) => {
    const page = store.listRepoRuns(String(req.params.repoId), req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  });

  return router;
}
