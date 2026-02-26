import { Router } from "express";
import { createAnalysisJobRoutes } from "../../modules/analysis-jobs/api/analysis-jobs.routes.js";
import { createFeedbackRoutes } from "../../modules/feedback/api/feedback.routes.js";
import { createGithubRoutes } from "../../modules/integrations/api/github.routes.js";
import { createGithubSessionRoutes } from "../../modules/integrations/api/github-session.routes.js";
import { createPrRoutes } from "../../modules/prs/api/prs.routes.js";
import { createReposRoutes } from "../../modules/repos/api/repos.routes.js";

export interface ApiRouterOptions {
  githubWebhookSecret: string | null;
}

export function createApiRouter(options: ApiRouterOptions) {
  const router = Router();

  router.use(createGithubRoutes({ webhookSecret: options.githubWebhookSecret }));
  router.use(createGithubSessionRoutes());
  router.use(createReposRoutes());
  router.use(createPrRoutes());
  router.use(createAnalysisJobRoutes());
  router.use(createFeedbackRoutes());

  return router;
}
