import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isIP } from 'node:net';
import { authenticateWebsiteLeadToken } from '../services/website-lead-tokens';

export const websiteLeadRateLimitKey = (req: { ip?: string; get: (name: string) => string | undefined }) => {
    const domain = authenticateWebsiteLeadToken(req.get('authorization'));
    const visitorIp = req.get('x-website-client-ip') ?? '';
    // Only the authenticated server of a website may supply a visitor address.
    if (domain && isIP(visitorIp)) return `website:${domain}:${ipKeyGenerator(visitorIp)}`;
    return ipKeyGenerator(req.ip || '127.0.0.1');
};

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

export const websiteLeadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: websiteLeadRateLimitKey,
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
