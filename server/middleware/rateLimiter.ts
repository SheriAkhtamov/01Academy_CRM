import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter for all mutation operations (POST, PUT, DELETE, PATCH)
 * Prevents abuse and DDoS attacks
 */
export const globalMutationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per IP
    message: 'Too many requests from this IP, please try again after a minute',
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
    message: 'Too many requests, please try again after a minute',
    standardHeaders: true,
    legacyHeaders: false,
});
