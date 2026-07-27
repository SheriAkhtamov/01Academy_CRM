import type { NextFunction, Request, Response } from 'express';
import {
  appConfig,
  isDevelopmentEnvironment,
  isProductionEnvironment,
} from '../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NON_BROWSER_MUTATION_PATHS = [
  /^\/api\/incoming(?:\/|$)/,
  /^\/api\/telephony\/webhook$/,
];

const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value || value === 'null') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const configuredOrigin = normalizeOrigin(appConfig.server.appUrl);
const allowedOrigins = new Set(
  [
    configuredOrigin,
    ...(isDevelopmentEnvironment
      ? [
          'http://localhost:5000',
          'http://127.0.0.1:5000',
          'http://localhost:5001',
          'http://127.0.0.1:5001',
          'http://localhost:5173',
          'http://127.0.0.1:5173',
        ]
      : []),
  ].filter((origin): origin is string => Boolean(origin)),
);

export const isAllowedRequestOrigin = (origin: string | undefined): boolean => {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && allowedOrigins.has(normalized));
};

const isNonBrowserMutationPath = (path: string) =>
  NON_BROWSER_MUTATION_PATHS.some((pattern) => pattern.test(path));

export const securityHeadersMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const scriptSources = ["'self'"];
  if (isDevelopmentEnvironment) {
    scriptSources.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isProductionEnvironment ? ['upgrade-insecure-requests'] : []),
  ];

  res.setHeader('Content-Security-Policy', directives.join('; '));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(self), payment=(), usb=()',
  );

  if (isProductionEnvironment) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
};

export const corsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const origin = req.get('origin');
  const originAllowed = !origin || isAllowedRequestOrigin(origin);

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'X-Request-Id',
      'X-Webhook-Secret',
      'X-Bot-Token',
      'X-Hub-Signature-256',
    ].join(', '),
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset',
  );
  res.setHeader('Access-Control-Max-Age', '600');

  if (origin && originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin)!);
  }

  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      return res.status(403).json({ error: 'originNotAllowed' });
    }
    return res.sendStatus(204);
  }

  if (origin && !originAllowed && req.path.startsWith('/api')) {
    return res.status(403).json({ error: 'originNotAllowed' });
  }

  next();
};

export const browserMutationProtectionMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (
    SAFE_METHODS.has(req.method)
    || !req.path.startsWith('/api')
    || isNonBrowserMutationPath(req.path)
  ) {
    return next();
  }

  const origin = req.get('origin');
  if (origin) {
    if (!isAllowedRequestOrigin(origin)) {
      return res.status(403).json({ error: 'crossSiteRequestBlocked' });
    }
    return next();
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'crossSiteRequestBlocked' });
  }

  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'csrfProtectionRequired' });
  }

  next();
};
