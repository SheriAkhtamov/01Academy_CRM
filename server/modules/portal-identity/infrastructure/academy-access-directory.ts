import type { Pool } from 'pg';
import type { AcademyPortalQuery, AcademyPortalPage, AcademyPortalLead } from '@shared/contracts/academy-portal-access';

const accountJson = (account: string, initial: string) => `CASE WHEN ${account}.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id',${account}.id,'login',${account}.login,'fullName',${account}.full_name,'status',${account}.status,'version',${account}.auth_version,
  'hasInitialPassword',COALESCE(${initial}.encrypted_password IS NOT NULL AND ${initial}.auth_version=${account}.auth_version AND ${initial}.expires_at>$2,false)) END`;
const where = `EXISTS(SELECT 1 FROM academy_students student WHERE student.lead_id=lead.id)
  AND ($1::text='' OR lead.contact_name ILIKE $1 ESCAPE '\\' OR lead.phone ILIKE $1 ESCAPE '\\'
    OR EXISTS(SELECT 1 FROM academy_students student WHERE student.lead_id=lead.id AND (
      student.student_name ILIKE $1 ESCAPE '\\' OR student.contact_name ILIKE $1 ESCAPE '\\'
      OR EXISTS(SELECT 1 FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id
        WHERE link.student_id=student.id AND link.kind='self' AND link.status<>'revoked' AND account.login ILIKE $1 ESCAPE '\\')))
    OR EXISTS(SELECT 1 FROM portal_lead_accounts mapped JOIN portal_accounts account ON account.id=mapped.account_id
      WHERE mapped.lead_id=lead.id AND account.login ILIKE $1 ESCAPE '\\'))`;

/** The directory reads CRM relationships; opening it never provisions or resets an account. */
export async function academyAccessDirectory(pool: Pool, query: AcademyPortalQuery, now: number): Promise<AcademyPortalPage> {
  const sql = await pool.connect();
  try {
    await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, character => `\\${character}`)}%` : '';
    const items = (await sql.query<{ item: AcademyPortalLead }>(`SELECT jsonb_build_object(
      'id',lead.id,'name',lead.contact_name,'phone',lead.phone,'role',mapped.role,
      'account',${accountJson('lead_account', 'lead_initial')},'students',children.items) AS item
      FROM academy_leads lead
      LEFT JOIN portal_lead_accounts mapped ON mapped.lead_id=lead.id
      LEFT JOIN portal_accounts lead_account ON lead_account.id=mapped.account_id
      LEFT JOIN portal_initial_credentials lead_initial ON lead_initial.account_id=lead_account.id
      CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',student.id,
        'name',COALESCE(NULLIF(student.student_name,''),student.contact_name),
        'classification',COALESCE(identity.classification,'unverified'),
        'account',${accountJson('student_account', 'student_initial')}) ORDER BY student.id) AS items
        FROM academy_students student
        LEFT JOIN portal_student_identity identity ON identity.student_id=student.id
        LEFT JOIN LATERAL(SELECT account.* FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id
          WHERE link.student_id=student.id AND link.kind='self' AND link.status<>'revoked' ORDER BY link.id LIMIT 1) student_account ON true
        LEFT JOIN portal_initial_credentials student_initial ON student_initial.account_id=student_account.id
        WHERE student.lead_id=lead.id) children
      WHERE ${where} ORDER BY lower(lead.contact_name),lead.id LIMIT $3 OFFSET $4`,
      [pattern, new Date(now), query.pageSize, (query.page - 1) * query.pageSize])).rows.map(row => row.item);
    const total = Number((await sql.query(`SELECT count(*) AS count FROM academy_leads lead WHERE ${where}`, [pattern])).rows[0].count);
    await sql.query('COMMIT');
    return { items, total, page: query.page, pageSize: query.pageSize };
  } catch (error) {
    await sql.query('ROLLBACK');
    throw error;
  } finally { sql.release(); }
}
