import { Router } from 'express';
import { pool } from '../db';
import { appConfig } from '../config';
import { logger } from '../lib/logger';

const router = Router();

router.use(expressRawJson);

// Webhook secrets are optional in dev (so local testing works), but when a secret is
// configured every inbound payload must carry it in the x-webhook-secret header.
const verifyWebhookSecret = (req: any, res: any, secretKey: 'chatplace' | 'bank'): boolean => {
  const configured = appConfig.integrations?.[secretKey]?.webhookSecret;
  if (!configured) {
    // No secret configured → allow (development mode). Log so it's visible.
    return true;
  }
  const provided = req.get('x-webhook-secret');
  if (provided && provided === configured) return true;
  res.status(401).json({ error: 'Invalid or missing webhook secret' });
  return false;
};

const getSystemUserId = async (): Promise<number> => {
  if (!pool) throw new Error('Database not available');
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role IN ('admin','head') AND is_active=true ORDER BY id LIMIT 1`,
  );
  if (!rows[0]?.id) throw new Error('No active admin/head user to attribute webhook actions');
  return Number(rows[0].id);
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camelize = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnake(key).replace(/_([a-z])/g, (_, l) => l.toUpperCase()), value]));

// ChatPlace → CRM (TZ 6): new Instagram DM leads.
router.post('/chatplace', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'chatplace')) return;
  try {
    const systemUserId = await getSystemUserId();
    const body = req.body ?? {};
    const contactName = String(body.contactName ?? body.name ?? 'Instagram lead').slice(0, 255);
    const phone = String(body.phone ?? 'unknown');
    const messenger = body.messenger ?? body.instagramUsername ?? null;

    const { rows: dupLead } = await pool.query(
      `SELECT 'lead' AS entity_type, id FROM academy_leads WHERE phone=$1 OR messenger=$2 LIMIT 1`,
      [phone, messenger],
    );
    if (dupLead[0]) {
      await logIntegration('chatplace', 'inbound', 'duplicate', body);
      return res.status(409).json({ error: 'Duplicate lead', duplicate: camelize(dupLead[0]) });
    }

    const { rows: sourceRows } = await pool.query(`SELECT id FROM academy_lead_sources WHERE code='instagram_dm' LIMIT 1`);
    const sourceId = sourceRows[0]?.id ?? (await fallbackSourceId());

    const { rows: inserted } = await pool.query(
      `INSERT INTO academy_leads
        (contact_name, phone, messenger, source_id, advertising_campaign, status_code, manager_id, language, created_by)
       VALUES ($1,$2,$3,$4,$5,'new_request',$6,'ru',$6) RETURNING *`,
      [contactName, phone, messenger, sourceId, body.campaign ?? null, systemUserId],
    );
    const lead = camelize(inserted[0]);
    await pool.query(
      `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
       VALUES ($1,NULL,'new_request',$2,'ChatPlace')`,
      [lead.id, systemUserId],
    );
    await logIntegration('chatplace', 'inbound', 'received', body);
    res.status(201).json(lead);
  } catch (error) {
    logger.error('Failed to receive ChatPlace lead', { error });
    res.status(500).json({ error: 'Failed to receive ChatPlace lead' });
  }
});

// Google Forms → CRM (TZ 6): demo registrations.
router.post('/google-forms', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'chatplace')) return;
  try {
    const systemUserId = await getSystemUserId();
    const body = req.body ?? {};
    const contactName = String(body.contactName ?? body.name ?? 'Google Forms lead').slice(0, 255);
    const phone = String(body.phone ?? 'unknown');
    const { rows: sourceRows } = await pool.query(`SELECT id FROM academy_lead_sources WHERE code='website' LIMIT 1`);
    const sourceId = sourceRows[0]?.id ?? (await fallbackSourceId());
    const statusCode = body.demoAt ? 'demo_invited' : 'new_request';

    const { rows: inserted } = await pool.query(
      `INSERT INTO academy_leads
        (contact_name, phone, student_name, course_id, source_id, status_code, manager_id, demo_at, language, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ru',$7) RETURNING *`,
      [contactName, phone, body.studentName ?? null, body.courseId ?? null, sourceId, statusCode, systemUserId, body.demoAt ?? null],
    );
    const lead = camelize(inserted[0]);
    await pool.query(
      `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
       VALUES ($1,NULL,$2,$3,'Google Forms')`,
      [lead.id, statusCode, systemUserId],
    );
    await logIntegration('google_forms', 'inbound', 'received', body);
    res.status(201).json(lead);
  } catch (error) {
    logger.error('Failed to receive Google Forms lead', { error });
    res.status(500).json({ error: 'Failed to receive Google Forms lead' });
  }
});

// Bank / payment provider → CRM (TZ 6): payment confirmation.
router.post('/bank', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'bank')) return;
  try {
    const body = req.body ?? {};
    const amountUzs = Math.round(Number(body.amountUzs ?? body.amount ?? 0));
    const studentId = body.studentId ? Number(body.studentId) : null;
    const leadId = body.leadId ? Number(body.leadId) : null;
    if (!amountUzs || (!studentId && !leadId)) {
      return res.status(400).json({ error: 'amountUzs and (studentId or leadId) are required' });
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO academy_payments
        (lead_id, student_id, amount_uzs, type, method, paid_at, period, discount, status, receipt_url)
       VALUES ($1,$2,$3,'full',COALESCE($4,'transfer'),NOW(),COALESCE($5,'month_1'),'none','paid',COALESCE($6,NULL))
       RETURNING *`,
      [leadId, studentId, amountUzs, body.method ?? null, body.period ?? null, body.receiptUrl ?? null],
    );
    await logIntegration('bank', 'inbound', 'received', body);
    res.status(201).json(camelize(inserted[0]));
  } catch (error) {
    logger.error('Failed to receive bank payment webhook', { error });
    res.status(500).json({ error: 'Failed to receive bank payment webhook' });
  }
});

const fallbackSourceId = async (): Promise<number> => {
  const { rows } = await pool.query(`SELECT id FROM academy_lead_sources WHERE code='organic' LIMIT 1`);
  if (rows[0]?.id) return Number(rows[0].id);
  const { rows: created } = await pool.query(
    `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active) VALUES ('organic','Organic','organic',true,true) RETURNING id`,
  );
  return Number(created[0].id);
};

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown) => {
  await pool.query(
    `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count) VALUES ($1,$2,$3,$4,0)`,
    [provider, direction, status, JSON.stringify(payload)],
  );
};

// Parse JSON bodies for these public webhook routes (mounted before the authed academy router).
function expressRawJson(req: any, _res: any, next: any) {
  // Express json() is applied globally before route mounting, so bodies are already parsed.
  next();
}

export default router;
