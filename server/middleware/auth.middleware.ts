import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from '../lib/logger';

// Authentication middleware
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.session?.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await storage.getUser(req.session.userId);
        if (!user || !user.isActive) {
            req.session.destroy(() => { });
            return res.status(401).json({ error: 'Invalid or inactive user' });
        }

        req.user = user;
        next();
    } catch (error) {
        logger.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, () => {
        if (req.user?.role !== 'admin' && req.user?.role !== 'head') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        next();
    });
};
