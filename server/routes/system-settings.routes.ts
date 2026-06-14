import { Router } from 'express';
import { storage } from '../storage';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import {
    getAiSettingsSummary,
    updateAiSettings,
    aiSettingsInputSchema,
} from '../services/ai-settings';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = await storage.getSystemSettings();
        res.json(settings);
    } catch (error) {
        logger.error('Failed to fetch system settings', { error });
        res.status(500).json({ error: 'Failed to fetch system settings' });
    }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { key, value, description } = req.body;

        if (!key || value === undefined || value === null) {
            return res.status(400).json({ error: 'Setting key and value are required' });
        }

        const setting = await storage.setSystemSetting({
            key,
            value,
            description,
        });

        res.json(setting);
    } catch (error) {
        logger.error('Failed to update system setting', { error });
        res.status(500).json({ error: 'Failed to update system setting' });
    }
});

router.get('/ai', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = await getAiSettingsSummary();
        res.json(settings);
    } catch (error) {
        logger.error('Failed to fetch AI settings', { error });
        res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
});

router.put('/ai', requireAuth, requireAdmin, async (req, res) => {
    try {
        const validation = aiSettingsInputSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.message });
        }

        const settings = await updateAiSettings(validation.data);
        res.json(settings);
    } catch (error) {
        logger.error('Failed to update AI settings', { error });
        res.status(500).json({ error: 'Failed to update AI settings' });
    }
});

export default router;
