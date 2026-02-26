import type { NextFunction, Request, Response } from "express";

const EXCLUDED_PREFIXES = ["/healthz", "/readyz", "/webhooks/github"];

export function serviceTokenAuth(serviceToken: string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!serviceToken) {
      next();
      return;
    }

    const isExcluded = EXCLUDED_PREFIXES.some((prefix) => req.path.startsWith(prefix));
    if (isExcluded) {
      next();
      return;
    }

    const authorization = req.header("authorization");
    const expected = `Bearer ${serviceToken}`;

    if (authorization !== expected) {
      res.status(401).json({
        error: {
          code: "unauthorized",
          message: "Invalid or missing service token",
        },
      });
      return;
    }

    next();
  };
}
