import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const rateLimitHandler = (_req: unknown, res: any) =>
    res.status(429).json({ error: 'tooManyRequests' });

/**
 * Global rate limiter for all mutation operations (POST, PUT, DELETE, PATCH)
 * Prevents abuse and DDoS attacks
 */
export const globalMutationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per IP
    handler: rateLimitHandler,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Skip successful responses (only count failed requests)
    skipSuccessfulRequests: false,
});

/**
 * Lenient rate limiter for read operations (GET)
 */
export const readLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 5000 requests per minute (increased for development)
    handler: rateLimitHandler,
    standardHeaders: true,
    legacyHeaders: false,
});

export const inboundWebhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    handler: rateLimitHandler,
    standardHeaders: true,
    legacyHeaders: false,
});

export const attachmentUploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    handler: rateLimitHandler,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id
        ? `user:${req.user.id}`
        : `ip:${ipKeyGenerator(req.ip || '127.0.0.1')}`,
});
