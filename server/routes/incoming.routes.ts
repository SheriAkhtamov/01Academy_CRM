import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig } from '../config';
import { logger } from '../lib/logger';
import { buildReferralCode } from '@shared/academy';

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

type QueryExecutor = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
};

const withIncomingTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getSystemUserId = async (executor: QueryExecutor = pool): Promise<number> => {
  const { rows } = await executor.query(
    `SELECT id FROM users WHERE role IN ('admin','head') AND is_active=true ORDER BY id LIMIT 1`,
  );
  if (!rows[0]?.id) throw new Error('No active admin/head user to attribute webhook actions');
  return Number(rows[0].id);
};

const getLeadAssigneeId = async (executor: QueryExecutor = pool): Promise<number> => {
  const { rows } = await executor.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN academy_leads l
       ON l.manager_id = u.id
      AND l.status_code NOT IN ('paid', 'not_now')
     WHERE u.role = 'account_manager' AND u.is_active = true
     GROUP BY u.id
     ORDER BY COUNT(l.id), u.id
     LIMIT 1`,
  );
  return rows[0]?.id ? Number(rows[0].id) : getSystemUserId(executor);
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camelize = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnake(key).replace(/_([a-z])/g, (_, l) => l.toUpperCase()), value]));

const findIncomingDuplicate = async (
  executor: QueryExecutor,
  phone: string,
  messenger?: string | null,
) => {
  const { rows } = await executor.query(
    `SELECT 'lead' AS entity_type, id, contact_name AS name, phone, messenger
     FROM academy_leads
     WHERE phone = $1 OR ($2::text IS NOT NULL AND messenger = $2)
     UNION ALL
     SELECT 'student' AS entity_type, id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE phone = $1 OR ($2::text IS NOT NULL AND messenger = $2)
     LIMIT 1`,
    [phone, messenger ?? null],
  );
  return rows[0] ?? null;
};

// ChatPlace → CRM (TZ 6): new Instagram DM leads.
router.post('/chatplace', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'chatplace')) return;
  try {
    const body = req.body ?? {};
    const contactName = String(body.contactName ?? body.name ?? 'Instagram lead').slice(0, 255);
    const messenger = body.messenger ?? body.instagramUsername ?? null;
    const phone = String(body.phone ?? messenger ?? '').trim();
    if (!phone) {
      return res.status(400).json({ error: 'phone or messenger is required' });
    }

    const result = await withIncomingTransaction(async (client) => {
      const systemUserId = await getSystemUserId(client);
      const managerId = await getLeadAssigneeId(client);
      const duplicate = await findIncomingDuplicate(client, phone, messenger);
      if (duplicate) return { duplicate: camelize(duplicate), lead: null };

      const { rows: sourceRows } = await client.query(`SELECT id FROM academy_lead_sources WHERE code='instagram_dm' LIMIT 1`);
      const sourceId = sourceRows[0]?.id ?? (await fallbackSourceId(client));

      const { rows: inserted } = await client.query(
        `INSERT INTO academy_leads
          (contact_name, phone, messenger, source_id, advertising_campaign, status_code, manager_id, language, created_by)
         VALUES ($1,$2,$3,$4,$5,'new_request',$6,'ru',$7) RETURNING *`,
        [contactName, phone, messenger, sourceId, body.campaign ?? null, managerId, systemUserId],
      );
      const lead = camelize(inserted[0]);
      await client.query(
        `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
         VALUES ($1,NULL,'new_request',$2,'ChatPlace')`,
        [lead.id, systemUserId],
      );
      await client.query(
        `INSERT INTO academy_tasks
          (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
         VALUES ('Первый контакт по новой заявке','Связаться с лидом в течение 15 минут.',$1,NOW() + INTERVAL '15 minutes','lead',$2,'new')`,
        [managerId, lead.id],
      );
      return { duplicate: null, lead };
    });

    if (result.duplicate) {
      await logIntegration('chatplace', 'inbound', 'duplicate', body);
      return res.status(409).json({ error: 'Duplicate lead or student', duplicate: result.duplicate });
    }

    await logIntegration('chatplace', 'inbound', 'received', body);
    res.status(201).json(result.lead);
  } catch (error) {
    logger.error('Failed to receive ChatPlace lead', { error });
    res.status(500).json({ error: 'Failed to receive ChatPlace lead' });
  }
});

// Google Forms → CRM (TZ 6): demo registrations.
router.post('/google-forms', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'chatplace')) return;
  try {
    const body = req.body ?? {};
    const contactName = String(body.contactName ?? body.name ?? 'Google Forms lead').slice(0, 255);
    const phone = String(body.phone ?? '').trim();
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const statusCode = body.demoAt ? 'demo_invited' : 'new_request';

    const result = await withIncomingTransaction(async (client) => {
      const systemUserId = await getSystemUserId(client);
      const managerId = await getLeadAssigneeId(client);
      const duplicate = await findIncomingDuplicate(client, phone);
      if (duplicate) return { duplicate: camelize(duplicate), lead: null };

      const { rows: sourceRows } = await client.query(`SELECT id FROM academy_lead_sources WHERE code='website' LIMIT 1`);
      const sourceId = sourceRows[0]?.id ?? (await fallbackSourceId(client));

      const { rows: inserted } = await client.query(
        `INSERT INTO academy_leads
          (contact_name, phone, student_name, course_id, source_id, status_code, manager_id, demo_at, language, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ru',$9) RETURNING *`,
        [contactName, phone, body.studentName ?? null, body.courseId ?? null, sourceId, statusCode, managerId, body.demoAt ?? null, systemUserId],
      );
      const lead = camelize(inserted[0]);
      await client.query(
        `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
         VALUES ($1,NULL,$2,$3,'Google Forms')`,
        [lead.id, statusCode, systemUserId],
      );
      await client.query(
        `INSERT INTO academy_tasks
          (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
         VALUES ($1,$2,$3,NOW() + INTERVAL '15 minutes','lead',$4,'new')`,
        [
          statusCode === 'demo_invited' ? 'Подтвердить запись на демо' : 'Первый контакт по новой заявке',
          statusCode === 'demo_invited' ? 'Связаться с клиентом и подтвердить детали демо.' : 'Связаться с лидом в течение 15 минут.',
          managerId,
          lead.id,
        ],
      );
      return { duplicate: null, lead };
    });

    if (result.duplicate) {
      await logIntegration('google_forms', 'inbound', 'duplicate', body);
      return res.status(409).json({ error: 'Duplicate lead or student', duplicate: result.duplicate });
    }
    await logIntegration('google_forms', 'inbound', 'received', body);
    res.status(201).json(result.lead);
  } catch (error) {
    logger.error('Failed to receive Google Forms lead', { error });
    res.status(500).json({ error: 'Failed to receive Google Forms lead' });
  }
});

// Bank / payment provider → CRM (TZ 6): payment confirmation.
router.post('/bank', async (req, res) => {
  if (!verifyWebhookSecret(req, res, 'bank')) return;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const body = req.body ?? {};
    const amountUzs = Math.round(Number(body.amountUzs ?? body.amount ?? 0));
    const studentId = body.studentId ? Number(body.studentId) : null;
    const leadId = body.leadId ? Number(body.leadId) : null;
    if (!Number.isFinite(amountUzs) || amountUzs <= 0 || (!studentId && !leadId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'amountUzs and (studentId or leadId) are required' });
    }

    const systemUserId = await getSystemUserId(client);
    const { rows: leadRows } = leadId
      ? await client.query(`SELECT * FROM academy_leads WHERE id=$1 FOR UPDATE`, [leadId])
      : { rows: [] };
    const lead = leadRows[0];
    if (leadId && !lead) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { rows: studentRows } = studentId
      ? await client.query(`SELECT * FROM academy_students WHERE id=$1 FOR UPDATE`, [studentId])
      : leadId
        ? await client.query(`SELECT * FROM academy_students WHERE lead_id=$1 FOR UPDATE`, [leadId])
        : { rows: [] };
    let student = studentRows[0] ?? null;
    if (studentId && !student) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }
    if (lead && student && Number(student.lead_id) !== Number(lead.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment lead and student do not match' });
    }

    if (!student && lead) {
      if (lead.enrolled_group_id) {
        const { rows: capacityRows } = await client.query(
          `SELECT g.max_students,
             (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id=g.id AND s.status='studying') AS current_students
           FROM academy_groups g WHERE g.id=$1 FOR UPDATE`,
          [lead.enrolled_group_id],
        );
        const capacity = capacityRows[0];
        if (capacity && Number(capacity.current_students) >= Number(capacity.max_students)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Selected group is full' });
        }
      }

      let courseId = lead.course_id;
      if (!courseId && lead.student_age) {
        const slug = Number(lead.student_age) <= 10
          ? 'ai-kids'
          : Number(lead.student_age) <= 15
            ? 'ai-creator'
            : 'vibe-coding';
        const { rows: courseRows } = await client.query(
          `SELECT id FROM academy_courses WHERE slug=$1 AND is_active=true ORDER BY id LIMIT 1`,
          [slug],
        );
        courseId = courseRows[0]?.id ?? null;
      }

      const referralCode = buildReferralCode(lead.student_name || lead.contact_name, lead.id);
      const { rows: createdStudents } = await client.query(
        `INSERT INTO academy_students
          (lead_id, group_id, contact_name, phone, messenger, student_name, student_age, course_id,
           manager_id, status, enrolled_at, next_payment_at, referral_code, risk_flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'studying',NOW(),NOW() + INTERVAL '30 days',$10,'[]'::jsonb)
         RETURNING *`,
        [
          lead.id,
          lead.enrolled_group_id ?? null,
          lead.contact_name,
          lead.phone,
          lead.messenger ?? null,
          lead.student_name || lead.contact_name,
          lead.student_age ?? null,
          courseId,
          lead.manager_id ?? systemUserId,
          referralCode,
        ],
      );
      student = createdStudents[0];
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO academy_payments
        (lead_id, student_id, amount_uzs, type, method, paid_at, paid_until, period, discount, status, receipt_url, confirmed_by)
       VALUES ($1,$2,$3,'full',COALESCE($4,'transfer'),NOW(),NOW() + INTERVAL '30 days',
         COALESCE($5,'month_1'),'none','paid',COALESCE($6,NULL),$7)
       RETURNING *`,
      [leadId, student?.id ?? studentId, amountUzs, body.method ?? null, body.period ?? null, body.receiptUrl ?? null, systemUserId],
    );

    if (student) {
      await client.query(
        `UPDATE academy_students SET next_payment_at=$1, updated_at=NOW() WHERE id=$2`,
        [inserted[0].paid_until, student.id],
      );
    }
    if (lead && lead.status_code !== 'paid') {
      await client.query(`UPDATE academy_leads SET status_code='paid', updated_at=NOW() WHERE id=$1`, [lead.id]);
      await client.query(
        `INSERT INTO academy_lead_stage_history
          (lead_id, from_status_code, to_status_code, changed_by, comment)
         VALUES ($1,$2,'paid',$3,'Автоматическое подтверждение оплаты банком')`,
        [lead.id, lead.status_code, systemUserId],
      );
    }

    await client.query('COMMIT');
    await logIntegration('bank', 'inbound', 'received', body);
    res.status(201).json(camelize(inserted[0]));
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    logger.error('Failed to receive bank payment webhook', { error });
    res.status(500).json({ error: 'Failed to receive bank payment webhook' });
  } finally {
    client?.release();
  }
});

const fallbackSourceId = async (executor: QueryExecutor = pool): Promise<number> => {
  const { rows } = await executor.query(`SELECT id FROM academy_lead_sources WHERE code='organic' LIMIT 1`);
  if (rows[0]?.id) return Number(rows[0].id);
  const { rows: created } = await executor.query(
    `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active) VALUES ('organic','Organic','organic',true,true) RETURNING id`,
  );
  return Number(created[0].id);
};

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown) => {
  try {
    await pool.query(
      `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count) VALUES ($1,$2,$3,$4,0)`,
      [provider, direction, status, JSON.stringify(payload)],
    );
  } catch (error) {
    logger.error('Failed to write integration log', { provider, direction, status, error });
  }
};

// Parse JSON bodies for these public webhook routes (mounted before the authed academy router).
function expressRawJson(req: any, _res: any, next: any) {
  // Express json() is applied globally before route mounting, so bodies are already parsed.
  next();
}

export default router;
