import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../../shared/errors/http-error.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  const err = error as { message?: string };

  res.status(500).json({
    error: {
      code: "internal_error",
      message: err.message ?? "Unexpected server error",
    },
  });
}
