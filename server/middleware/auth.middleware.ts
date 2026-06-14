import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from '../lib/logger';

const hasPermission = (user: any, permission: string): boolean => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'head') return true;
    if (['operations_director', 'smm_manager'].includes(user.role) && permission === 'view_reports') return true;
    return false;
};

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

export const requireFileAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.session?.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await storage.getUser(req.session.userId);
        if (user?.isActive) {
            req.user = user;
            return next();
        }

        req.session.destroy(() => { });
        return res.status(401).json({ error: 'Invalid or inactive session' });
    } catch (error) {
        logger.error('File access middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
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

export const requireAnalyticsAccess = async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, () => {
        const user = req.user;
        if (user?.role === 'admin' || user?.role === 'head' || user?.role === 'operations_director' || user?.role === 'smm_manager' || Boolean(user?.hasReportAccess)) {
            next();
        } else {
            return res.status(403).json({ error: 'Analytics access not allowed. Contact administrator to enable report access.' });
        }
    });
};

export const requirePermission = (permission: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        await requireAuth(req, res, () => {
            if (!hasPermission(req.user, permission)) {
                return res.status(403).json({ error: `Permission '${permission}' required` });
            }
            next();
        });
    };
};

export const requireSalesAccess = async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, () => {
        if (req.user?.role !== 'account_manager' && req.user?.role !== 'admin' && req.user?.role !== 'head') {
            return res.status(403).json({ error: 'Sales access required' });
        }
        next();
    });
};

export const requireReportAccess = async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, () => {
        if (!req.user?.hasReportAccess && req.user?.role !== 'admin' && req.user?.role !== 'head' && req.user?.role !== 'operations_director' && req.user?.role !== 'smm_manager') {
            return res.status(403).json({ error: 'Report access required' });
        }
        next();
    });
};
