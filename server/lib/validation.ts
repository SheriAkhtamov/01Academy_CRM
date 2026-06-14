import { z } from 'zod';

/**
 * Centralized validation schemas to avoid duplication
 */

// Email validation - более строгая проверка
export const emailSchema = z.string()
    .email('Invalid email format')
    .min(5, 'Email must be at least 5 characters')
    .max(255, 'Email must not exceed 255 characters')
    .regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid email format')
    .transform(email => email.toLowerCase().trim());

// Phone validation
export const phoneSchema = z.string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
    .optional()
    .nullable();

// Name validation
export const nameSchema = z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must not exceed 100 characters')
    .regex(/^[a-zA-Zа-яА-ЯёЁ\s\-']+$/, "Name can only contain letters, spaces, hyphens and apostrophes");

// Password validation
export const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must not exceed 72 characters') // bcrypt truncates at 72 bytes
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');

// ID validation
export const idSchema = z.number().int().positive('ID must be a positive integer');

// Date validation
export const dateSchema = z.string().datetime('Invalid date format');

// URL validation
export const urlSchema = z.string().url('Invalid URL format').optional().nullable();

/**
 * Common error messages
 */
export const ErrorMessages = {
    // Authentication
    AUTH_REQUIRED: 'Authentication required',
    AUTH_INVALID: 'Invalid credentials',
    AUTH_EXPIRED: 'Session expired',

    // Authorization
    FORBIDDEN: 'You do not have permission to perform this action',
    ADMIN_REQUIRED: 'Administrator privileges required',

    // Not Found
    NOT_FOUND: (entity: string) => `${entity} not found`,

    // Validation
    INVALID_INPUT: 'Invalid input data',
    REQUIRED_FIELD: (field: string) => `${field} is required`,

    // Duplicate
    ALREADY_EXISTS: (entity: string) => `${entity} already exists`,

    // Database
    DB_ERROR: 'Database error occurred',
    DB_CONNECTION: 'Failed to connect to database',

    // Generic
    SERVER_ERROR: 'Internal server error',
    OPERATION_FAILED: (operation: string) => `Failed to ${operation}`,
} as const;

/**
 * Custom Error Classes for better error handling
 */
export class ValidationError extends Error {
    constructor(message: string, public details?: any) {
        super(message);
        this.name = 'ValidationError';
    }
}

export class AuthenticationError extends Error {
    constructor(message: string = ErrorMessages.AUTH_INVALID) {
        super(message);
        this.name = 'AuthenticationError';
    }
}

export class AuthorizationError extends Error {
    constructor(message: string = ErrorMessages.FORBIDDEN) {
        super(message);
        this.name = 'AuthorizationError';
    }
}

export class NotFoundError extends Error {
    constructor(entity: string) {
        super(ErrorMessages.NOT_FOUND(entity));
        this.name = 'NotFoundError';
    }
}

export class DuplicateError extends Error {
    constructor(entity: string) {
        super(ErrorMessages.ALREADY_EXISTS(entity));
        this.name = 'DuplicateError';
    }
}
