import type { Response } from 'express';

type HttpErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

const toStatus = (value: unknown): number | null => {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : null;
};

export const getHttpErrorStatus = (error: unknown): number => {
  const typed = error as HttpErrorLike | null | undefined;
  return toStatus(typed?.statusCode) ?? toStatus(typed?.status) ?? 500;
};

const sanitizeMessage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return sanitized ? sanitized.slice(0, 240) : null;
};

export const getPublicErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  const status = getHttpErrorStatus(error);
  if (status >= 500) return fallback;
  return sanitizeMessage((error as HttpErrorLike | null | undefined)?.message)
    ?? fallback;
};

export const sendHttpError = (
  res: Response,
  error: unknown,
  fallback: string,
  extra: Record<string, unknown> = {},
) => {
  const status = getHttpErrorStatus(error);
  return res.status(status).json({
    error: getPublicErrorMessage(error, fallback),
    ...extra,
  });
};
