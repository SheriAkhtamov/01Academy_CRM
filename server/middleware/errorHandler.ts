import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { toApiErrorKey } from "../lib/apiErrorKeys";

const extractRequestId = (req: Request): string => {
  const headerId = req.headers["x-request-id"];
  if (Array.isArray(headerId)) {
    return headerId[0] ?? randomUUID();
  }
  return headerId ?? randomUUID();
};

const extractUserId = (req: Request): number | undefined => {
  if (req.user?.id) {
    return req.user.id;
  }
  if (req.session?.userId) {
    return req.session.userId;
  }
  return undefined;
};

export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = extractRequestId(req);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (req.path.startsWith("/api") && body && typeof body === "object" && res.statusCode >= 400) {
      const nextBody = { ...body };

      if (typeof nextBody.error === "string") {
        nextBody.error = toApiErrorKey(nextBody.error);
      }

      if (typeof nextBody.message === "string") {
        nextBody.message = toApiErrorKey(nextBody.message);
      }

      return originalJson(nextBody);
    }

    return originalJson(body);
  }) as Response["json"];

  next();
};

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  logger.error("Server Error", {
    status,
    message,
    requestId: req.requestId,
    userId: extractUserId(req),
    route: req.originalUrl,
    method: req.method,
    stack: err.stack,
  });

  res.status(status).json({ message });
};
