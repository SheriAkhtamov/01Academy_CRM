import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth.middleware';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import {
  ACTIVE_PIPELINE_STATUSES,
  DEFAULT_LEAD_SOURCES,
  LEAD_STATUSES,
  addDays,
  addMinutes,
  buildReferralCode,
  calculateAttendancePercent,
  calculateAverage,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  deriveGroupEndDate,
  getComputedPaymentStatus,
  normalizeMoney,
  suggestCourseSlugByAge,
  validateLeadForStatusChange } from '@shared/academy';

const router = Router();

router.use(requireAuth);

type DbValue = string | number | boolean | Date | null | unknown[] | Record<string, unknown>;
type Row = Record<string, any>;

const HEAD_ROLES = new Set(['admin', 'head']);
const FINANCE_ROLES = new Set(['admin', 'head', 'operations_director']);
const OPERATIONS_ROLES = new Set(['admin', 'head', 'operations_director']);
const MARKETING_ROLES = new Set(['admin', 'head', 'smm_manager']);

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const camelize = (row: Row): Row => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [toCamel(key), value]),
);

const camelizeRows = (rows: Row[]) => rows.map(camelize);

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const TABLES_WITHOUT_UPDATED_AT = new Set([
  'academy_lead_stage_history',
  'academy_communications',
  'academy_student_transfers',
  'academy_student_status_history',
  'academy_lesson_status_history',
  'academy_lesson_surveys',
  'academy_parent_surveys',
  'academy_referral_rewards',
]);

const parseId = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const nullableText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const nullableDate = (value: unknown) => {
  const text = nullableText(value);
  if (text === undefined || text === null) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIntegerOrNull = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

const safeJson = (value: unknown, fallback: unknown[] = []) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const query = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const result = await pool.query(sql, values as any[]);
  return camelizeRows(result.rows) as T[];
};

const queryOne = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const rows = await query<T>(sql, values);
  return rows[0] as T | undefined;
};

const insertRow = async (table: string, values: Record<string, DbValue | undefined>) => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined) as Array<[string, DbValue]>;
  if (entries.length === 0) {
    throw new Error('No values provided');
  }

  const columns = entries.map(([key]) => quoteIdent(toSnake(key)));
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  const params = entries.map(([, value]) => value);
  const rows = await query(
    `INSERT INTO ${quoteIdent(table)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    params,
  );
  return rows[0];
};

const updateRow = async (table: string, id: number, values: Record<string, DbValue | undefined>) => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined) as Array<[string, DbValue]>;
  if (entries.length === 0) {
    return queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
  }

  const assignments = entries.map(([key], index) => `${quoteIdent(toSnake(key))} = $${index + 2}`);
  const params = [id, ...entries.map(([, value]) => value)];
  const updatedAtAssignment = TABLES_WITHOUT_UPDATED_AT.has(table) ? '' : ', updated_at = NOW()';
  const rows = await query(
    `UPDATE ${quoteIdent(table)}
     SET ${assignments.join(', ')}${updatedAtAssignment}
     WHERE id = $1
     RETURNING *`,
    params,
  );
  return rows[0];
};

const deleteRow = async (table: string, id: number) => {
  await pool.query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
};

const ensureFinanceAccess = (req: any, res: any) => {
  if (FINANCE_ROLES.has(req.user?.role)) return true;
  res.status(403).json({ error: 'Finance access required' });
  return false;
};

const ensureOperationsAccess = (req: any, res: any) => {
  if (OPERATIONS_ROLES.has(req.user?.role) || req.user?.role === 'teacher') return true;
  res.status(403).json({ error: 'Operations access required' });
  return false;
};

const ensureMarketingAccess = (req: any, res: any) => {
  if (MARKETING_ROLES.has(req.user?.role) || req.user?.role === 'account_manager') return true;
  res.status(403).json({ error: 'Marketing access required' });
  return false;
};

const createAudit = async (req: any, action: string, entityType: string, entityId: number, newValues?: unknown, oldValues?: unknown) => {
  await storage.createAuditLog({
    userId: req.user!.id,
    action,
    entityType,
    entityId,
    oldValues: oldValues ? [oldValues] : undefined,
    newValues: newValues ? [newValues] : undefined }).catch((error) => logger.error('Failed to write academy audit log', { error, action, entityType, entityId }));
};

const createNotification = async (userId: number | null | undefined, title: string, message: string, entityType?: string, entityId?: number) => {
  if (!userId) return;
  await storage.createNotification({
    userId,
    type: 'academy_task',
    title,
    message,
    relatedEntityType: entityType,
    relatedEntityId: entityId }).catch((error) => logger.error('Failed to create notification', { error, userId }));
};

const createTask = async (title: string, options: {
  responsibleId?: number | null;
  description?: string | null;
  deadlineAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => insertRow('academy_tasks', {
  title,
  description: options.description ?? null,
  responsibleId: options.responsibleId ?? null,
  deadlineAt: options.deadlineAt ?? null,
  entityType: options.entityType ?? null,
  entityId: options.entityId ?? null,
  status: 'new' });

const createOutbox = async (channel: string, recipient: string, message: string, options: {
  scheduledAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => insertRow('academy_notification_outbox', {
  channel,
  recipient,
  message,
  status: 'pending',
  scheduledAt: options.scheduledAt ?? new Date(),
  entityType: options.entityType ?? null,
  entityId: options.entityId ?? null });

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown, errorMessage?: string | null) =>
  insertRow('academy_integration_logs', {
    provider,
    direction,
    status,
    payload: payload as any,
    errorMessage: errorMessage ?? null,
    retryCount: 0 });

const getSourceByCode = async (code: string) =>
  queryOne(`SELECT * FROM academy_lead_sources WHERE code = $1`, [code]);

const getDefaultSource = async () => {
  const source = await getSourceByCode('organic');
  if (source) return source;
  return insertRow('academy_lead_sources', {
    code: 'organic',
    name: 'Organic',
    channel: 'organic',
    isSystem: true,
    isActive: true });
};

const resolveSourceId = async (body: Row) => {
  const explicitSourceId = parseId(body.sourceId);
  if (explicitSourceId) return explicitSourceId;

  const sourceCode = nullableText(body.sourceCode);
  if (sourceCode) {
    const source = await getSourceByCode(sourceCode);
    if (source) return Number(source.id);
    const created = await insertRow('academy_lead_sources', {
      code: sourceCode,
      name: sourceCode,
      channel: sourceCode.split('_')[0],
      campaignName: nullableText(body.advertisingCampaign) ?? null,
      isSystem: false,
      isActive: true });
    return Number(created.id);
  }

  return null;
};

const resolveCourseByAge = async (age?: number | null) => {
  const slug = suggestCourseSlugByAge(age);
  if (!slug) return null;
  const course = await queryOne(`SELECT * FROM academy_courses WHERE slug = $1`, [slug]);
  return course ?? null;
};

const findDuplicate = async (phone?: string | null, messenger?: string | null) => {
  if (!phone && !messenger) return null;

  const duplicateLead = await queryOne(
    `SELECT 'lead' AS entity_type, id, contact_name AS name, phone, messenger
     FROM academy_leads
     WHERE (($1::text IS NOT NULL AND phone = $1) OR ($2::text IS NOT NULL AND messenger = $2))
     LIMIT 1`,
    [phone ?? null, messenger ?? null],
  );
  if (duplicateLead) return duplicateLead;

  return queryOne(
    `SELECT 'student' AS entity_type, id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE (($1::text IS NOT NULL AND phone = $1) OR ($2::text IS NOT NULL AND messenger = $2))
     LIMIT 1`,
    [phone ?? null, messenger ?? null],
  );
};

const getLead = (id: number) =>
  queryOne(`SELECT * FROM academy_leads WHERE id = $1`, [id]);

const createStageHistory = async (leadId: number, fromStatusCode: string | null, toStatusCode: string, changedBy: number, comment?: string | null) =>
  insertRow('academy_lead_stage_history', {
    leadId,
    fromStatusCode,
    toStatusCode,
    changedBy,
    comment: comment ?? null });

const buildLeadStageDurations = (history: Row[]) => {
  const sorted = [...history].sort((left, right) =>
    new Date(left.enteredAt).getTime() - new Date(right.enteredAt).getTime()
  );

  return sorted.map((item, index) => {
    const enteredAt = new Date(item.enteredAt);
    const nextEnteredAt = sorted[index + 1]?.enteredAt ? new Date(sorted[index + 1].enteredAt) : new Date();
    const minutes = Math.max(0, Math.round((nextEnteredAt.getTime() - enteredAt.getTime()) / 60000));
    return {
      statusCode: item.toStatusCode,
      statusName: LEAD_STATUSES.find((status) => status.code === item.toStatusCode)?.name ?? item.toStatusCode,
      enteredAt: item.enteredAt,
      minutes,
      hours: Number((minutes / 60).toFixed(1)),
      days: Number((minutes / 1440).toFixed(1)) };
  });
};

const ensureGroupCapacity = async (groupId?: number | null) => {
  if (!groupId) return;
  const capacity = await queryOne<{ count: string; maxStudents: number }>(
    `SELECT COUNT(s.id)::text AS count, g.max_students
     FROM academy_groups g
     LEFT JOIN academy_students s ON s.group_id = g.id AND s.status = 'studying'
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId],
  );

  if (capacity && Number(capacity.count) >= Number(capacity.maxStudents)) {
    throw Object.assign(new Error('Group is full'), { statusCode: 409 });
  }
};

const recalculateStudentMetrics = async (studentId: number) => {
  const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
  if (!student?.groupId) return;

  const conductedLessons = await query<{ id: number }>(
    `SELECT id FROM academy_lessons WHERE group_id = $1 AND status = 'conducted'`,
    [student.groupId],
  );
  const presentRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM academy_attendance a
     JOIN academy_lessons l ON l.id = a.lesson_id
     WHERE a.student_id = $1 AND a.status = 'present' AND l.status = 'conducted'`,
    [studentId],
  );
  const course = student.courseId
    ? await queryOne(`SELECT lesson_count FROM academy_courses WHERE id = $1`, [student.courseId])
    : null;
  const surveyRows = await query<{ score: number }>(
    `SELECT score FROM academy_lesson_surveys WHERE student_id = $1`,
    [studentId],
  );

  const presentCount = Number(presentRows[0]?.count ?? 0);
  const attendancePercent = calculateAttendancePercent(presentCount, conductedLessons.length);
  const progressPercent = calculateProgressPercent(presentCount, Number(course?.lessonCount ?? conductedLessons.length));
  const satisfactionAvg = calculateAverage(surveyRows.map((row) => Number(row.score))) ?? 0;
  const riskFlags = [
    attendancePercent > 0 && attendancePercent < 70 ? 'attendance_below_70' : null,
    attendancePercent > 0 && attendancePercent < 50 ? 'churn_risk' : null,
    satisfactionAvg > 0 && satisfactionAvg < 3 ? 'low_satisfaction' : null,
  ].filter(Boolean);

  await updateRow('academy_students', studentId, {
    attendancePercent,
    progressPercent,
    satisfactionAvg,
    riskFlags });
};

const createStudentFromLead = async (req: any, leadId: number, paymentId?: number | null) => {
  const lead = await getLead(leadId);
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }

  const existingStudent = await queryOne(`SELECT * FROM academy_students WHERE lead_id = $1`, [leadId]);
  if (existingStudent) return existingStudent;

  await ensureGroupCapacity(lead.enrolledGroupId);

  const course = lead.courseId
    ? await queryOne(`SELECT * FROM academy_courses WHERE id = $1`, [lead.courseId])
    : await resolveCourseByAge(lead.studentAge);

  const referralCode = buildReferralCode(lead.studentName || lead.contactName, lead.id);
  const student = await insertRow('academy_students', {
    leadId: lead.id,
    contactName: lead.contactName,
    phone: lead.phone,
    messenger: lead.messenger ?? null,
    studentName: lead.studentName || lead.contactName,
    age: lead.studentAge ?? null,
    courseId: lead.courseId ?? course?.id ?? null,
    groupId: lead.enrolledGroupId ?? null,
    managerId: lead.managerId ?? req.user!.id,
    status: 'studying',
    enrolledAt: new Date(),
    nextPaymentAt: addDays(new Date(), 30),
    referralCode,
    riskFlags: [] });

  if (paymentId) {
    await updateRow('academy_payments', paymentId, { studentId: student.id });
  }

  await updateRow('academy_leads', lead.id, { statusCode: 'paid' });
  await createStageHistory(lead.id, lead.statusCode, 'paid', req.user!.id, 'Автоматическое создание ученика после оплаты');

  if (lead.referrerStudentId && Number(lead.referrerStudentId) !== Number(student.id)) {
    await insertRow('academy_referral_rewards', {
      referrerStudentId: Number(lead.referrerStudentId),
      referredLeadId: lead.id,
      referredStudentId: student.id,
      rewardType: 'discount',
      rewardValue: '15%',
      status: 'pending' });
  }

  await createOutbox('telegram', lead.messenger || lead.phone, `Добро пожаловать в 01 Academy, ${student.studentName}!`, {
    entityType: 'student',
    entityId: student.id });
  await createAudit(req, 'CREATE_ACADEMY_STUDENT_FROM_LEAD', 'academy_student', student.id, student);
  return student;
};

const handleLeadAutomation = async (req: any, lead: Row, previousStatus?: string | null) => {
  const managerId = lead.managerId ?? req.user!.id;
  const now = new Date();

  if (lead.statusCode === 'new_request') {
    await createTask('Первый контакт по новой заявке', {
      responsibleId: managerId,
      deadlineAt: addMinutes(now, 15),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Связаться с лидом в течение 15 минут после заявки.' });
    await createNotification(managerId, 'Новая заявка 01 Academy', `${lead.contactName}: ${lead.phone}`, 'lead', lead.id);
    await createOutbox('telegram', String(managerId), `Новая заявка: ${lead.contactName}, ${lead.phone}`, {
      scheduledAt: now,
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'first_contact' && !lead.firstContactAt) {
    await updateRow('academy_leads', lead.id, { firstContactAt: now });
  }

  if (lead.statusCode === 'demo_invited' && lead.demoAt) {
    const demoAt = new Date(lead.demoAt);
    await createOutbox('telegram', lead.messenger || lead.phone, `Напоминание: демо-урок 01 Academy через 24 часа`, {
      scheduledAt: addDays(demoAt, -1),
      entityType: 'lead',
      entityId: lead.id });
    await createOutbox('whatsapp', lead.phone, `Напоминание: демо-урок 01 Academy через 2 часа`, {
      scheduledAt: addMinutes(demoAt, -120),
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'demo_attended') {
    await createTask('Follow-up после демо', {
      responsibleId: managerId,
      deadlineAt: addMinutes(now, 240),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Связаться через 2-4 часа после демо и зафиксировать результат.' });
  }

  if (lead.statusCode === 'offer') {
    await createTask('Проверить ответ на предложение', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 3),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Если нет ответа 3 дня, сделать повторный контакт.' });
  }

  if (lead.statusCode === 'thinking') {
    await createTask('Напоминание: лид думает 3 дня', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 3),
      entityType: 'lead',
      entityId: lead.id });
    await createTask('Повторное напоминание: лид думает 7 дней', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 7),
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'enrolled' && previousStatus !== 'enrolled') {
    await insertRow('academy_payments', {
      leadId: lead.id,
      amountUzs: normalizeMoney(lead.expectedPaymentUzs || lead.offerPriceUzs),
      type: 'full',
      method: lead.paymentMethod || 'transfer',
      status: 'pending',
      dueAt: addDays(now, 3),
      period: 'month_1',
      discount: lead.offerDiscount || 'none',
      comment: 'Ожидаемая оплата после записи на курс' });
    await createOutbox('telegram', lead.messenger || lead.phone, 'Реквизиты для оплаты 01 Academy: карта/перевод/наличные у администратора. После оплаты отправьте чек менеджеру.', {
      scheduledAt: now,
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'not_now') {
    await updateRow('academy_leads', lead.id, {
      warmMovedAt: lead.warmMovedAt ?? now,
      warmReason: lead.warmReason ?? 'Перенесён в тёплую базу' });
  }
};

const getAcademyDataset = async () => {
  const [
    courses,
    sources,
    statuses,
    teachers,
    groups,
    leads,
    students,
    lessons,
    attendance,
    payments,
    tasks,
    lessonSurveys,
    parentSurveys,
    expenses,
    projects,
    referrals,
  ] = await Promise.all([
    query(`SELECT * FROM academy_courses ORDER BY name`),
    query(`SELECT * FROM academy_lead_sources ORDER BY name`),
    query(`SELECT * FROM academy_lead_statuses ORDER BY sort_order`),
    query(`SELECT * FROM academy_teachers ORDER BY full_name`),
    query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
      (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id = g.id AND s.status = 'studying') AS current_students
      FROM academy_groups g
      LEFT JOIN academy_courses c ON c.id = g.course_id
      LEFT JOIN academy_teachers t ON t.id = g.teacher_id
      ORDER BY g.created_at DESC`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, u.full_name AS manager_name
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id
      LEFT JOIN users u ON u.id = l.manager_id
      ORDER BY l.created_at DESC`),
    query(`SELECT st.*, c.name AS course_name, g.name AS group_name, u.full_name AS manager_name
      FROM academy_students st
      LEFT JOIN academy_courses c ON c.id = st.course_id
      LEFT JOIN academy_groups g ON g.id = st.group_id
      LEFT JOIN users u ON u.id = st.manager_id
      ORDER BY st.created_at DESC`),
    query(`SELECT l.*, g.name AS group_name, t.full_name AS teacher_name, c.name AS course_name
      FROM academy_lessons l
      LEFT JOIN academy_groups g ON g.id = l.group_id
      LEFT JOIN academy_teachers t ON t.id = l.teacher_id
      LEFT JOIN academy_courses c ON c.id = l.course_id
      ORDER BY l.scheduled_at DESC`),
    query(`SELECT * FROM academy_attendance`),
    query(`SELECT p.*, st.student_name, l.contact_name AS lead_name
      FROM academy_payments p
      LEFT JOIN academy_students st ON st.id = p.student_id
      LEFT JOIN academy_leads l ON l.id = p.lead_id
      ORDER BY p.created_at DESC`),
    query(`SELECT t.*, u.full_name AS responsible_name
      FROM academy_tasks t
      LEFT JOIN users u ON u.id = t.responsible_id
      ORDER BY COALESCE(t.deadline_at, t.created_at)`),
    query(`SELECT * FROM academy_lesson_surveys`),
    query(`SELECT * FROM academy_parent_surveys`),
    query(`SELECT * FROM academy_marketing_expenses ORDER BY period_start DESC`),
    query(`SELECT * FROM academy_portfolio_projects ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
  ]);

  return { courses, sources, statuses, teachers, groups, leads, students, lessons, attendance, payments, tasks, lessonSurveys, parentSurveys, expenses, projects, referrals };
};

const buildAnalytics = async () => {
  const data = await getAcademyDataset();
  const now = new Date();
  const weekStart = addDays(now, -7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const paidPayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid');
  const revenueMonth = paidPayments
    .filter((payment) => payment.paidAt && new Date(payment.paidAt) >= monthStart && new Date(payment.paidAt) <= monthEnd)
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const revenueTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const avgCheck = calculateAverage(paidPayments.map((payment) => Number(payment.amountUzs || 0))) ?? 0;
  const newPaidStudents = new Set(paidPayments.map((payment) => payment.studentId).filter(Boolean));
  const expensesMonth = data.expenses
    .filter((expense) => new Date(expense.periodStart) <= monthEnd && new Date(expense.periodEnd) >= monthStart)
    .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
  const cac = calculateCac(expensesMonth, newPaidStudents.size) ?? 0;
  const roas = calculateRoas(revenueMonth, expensesMonth) ?? 0;
  const ltvByStudent = data.students.map((student) => ({
    studentId: student.id,
    ltv: calculateLtv(paidPayments.filter((payment) => payment.studentId === student.id).map((payment) => Number(payment.amountUzs || 0))) }));
  const averageLtv = calculateAverage(ltvByStudent.map((item) => item.ltv)) ?? 0;
  const overduePayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'overdue');
  const overdueTasks = data.tasks.filter((task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now);
  const lowAttendanceStudents = data.students.filter((student) => Number(student.attendancePercent || 0) > 0 && Number(student.attendancePercent || 0) < 70);
  const lowScores = data.lessonSurveys.filter((survey) => Number(survey.score) < 3);
  const longThinkingLeads = data.leads.filter((lead) =>
    lead.statusCode === 'thinking' && lead.updatedAt && new Date(lead.updatedAt) < addDays(now, -7)
  );
  const nps = calculateNps(data.parentSurveys.map((survey) => Number(survey.npsScore)).filter(Number.isFinite)) ?? 0;

  const funnel = LEAD_STATUSES.map((status) => ({
    ...status,
    count: data.leads.filter((lead) => lead.statusCode === status.code).length }));

  const groupsWithCapacity = data.groups.map((group) => ({
    ...group,
    currentStudents: Number(group.currentStudents || 0),
    capacityLabel: `${Number(group.currentStudents || 0)}/${Number(group.maxStudents || 12)}`,
    isFull: Number(group.currentStudents || 0) >= Number(group.maxStudents || 12) }));

  const teacherHours = data.lessons
    .filter((lesson) => lesson.status === 'conducted')
    .reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0);

  return {
    summary: {
      newLeadsWeek: data.leads.filter((lead) => new Date(lead.createdAt) >= weekStart).length,
      newLeadsMonth: data.leads.filter((lead) => new Date(lead.createdAt) >= monthStart).length,
      activeLeads: data.leads.filter((lead) => ACTIVE_PIPELINE_STATUSES.includes(lead.statusCode)).length,
      warmBaseSize: data.leads.filter((lead) => lead.statusCode === 'not_now').length,
      activeStudents: data.students.filter((student) => student.status === 'studying').length,
      revenueMonth,
      revenueTotal,
      avgCheck,
      cac,
      roas,
      averageLtv,
      ltvCac: cac ? Number((averageLtv / cac).toFixed(2)) : 0,
      avgAttendance: calculateAverage(data.students.map((student) => Number(student.attendancePercent || 0)).filter(Boolean)) ?? 0,
      nps,
      teacherHours,
      overduePayments: overduePayments.length,
      overdueTasks: overdueTasks.length,
      newPaidStudents: newPaidStudents.size },
    funnel,
    groups: groupsWithCapacity,
    risks: {
      lowAttendanceStudents,
      lowScores,
      overduePayments,
      longThinkingLeads,
      overdueTasks },
    byCourse: data.courses.map((course) => ({
      courseId: course.id,
      courseName: course.name,
      leads: data.leads.filter((lead) => lead.courseId === course.id).length,
      students: data.students.filter((student) => student.courseId === course.id && student.status === 'studying').length,
      revenue: paidPayments
        .filter((payment) => data.students.find((student) => student.id === payment.studentId)?.courseId === course.id)
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
      averageLtv: calculateAverage(
        ltvByStudent
          .filter((item) => data.students.find((student) => student.id === item.studentId)?.courseId === course.id)
          .map((item) => item.ltv),
      ) ?? 0,
      ltvTargetMinUzs: course.ltvTargetMinUzs,
      ltvTargetMaxUzs: course.ltvTargetMaxUzs })),
    bySource: data.sources.map((source) => {
      const sourceLeads = data.leads.filter((lead) => lead.sourceId === source.id);
      const sourceStudents = data.students.filter((student) => sourceLeads.some((lead) => lead.id === student.leadId));
      const sourceRevenue = paidPayments
        .filter((payment) => sourceStudents.some((student) => student.id === payment.studentId))
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
      const sourceExpenses = data.expenses
        .filter((expense) => expense.sourceId === source.id)
        .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
      const sourceCac = calculateCac(sourceExpenses, sourceStudents.length) ?? 0;
      return {
        sourceId: source.id,
        sourceName: source.name,
        leads: sourceLeads.length,
        paidStudents: sourceStudents.length,
        revenue: sourceRevenue,
        expenses: sourceExpenses,
        cac: sourceCac,
        roas: calculateRoas(sourceRevenue, sourceExpenses) ?? 0,
        ltvCac: sourceCac ? Number(((calculateAverage(sourceStudents.map((student) => ltvByStudent.find((item) => item.studentId === student.id)?.ltv || 0)) ?? 0) / sourceCac).toFixed(2)) : 0 };
    }),
    data };
};

const createCsv = (rows: Row[]) => {
  if (rows.length === 0) return 'нет данных\n';
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
};

router.post('/seed', async (req, res) => {
  try {
    const existingCourses = await query(`SELECT id FROM academy_courses LIMIT 1`, []);

    if (existingCourses.length === 0) {
      for (const course of req.body?.courses ?? []) {
        await insertRow('academy_courses', {
          ...course,
          program: safeJson(course.program, []),
          isActive: course.isActive ?? true });
      }
    }

    for (const code of DEFAULT_LEAD_SOURCES) {
      const existing = await getSourceByCode(code);
      if (!existing) {
        await insertRow('academy_lead_sources', {
          code,
          name: code,
          channel: code.split('_')[0],
          isSystem: true,
          isActive: true });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Failed to seed academy data', { error });
    res.status(500).json({ error: 'Failed to seed academy data' });
  }
});

router.get('/bootstrap', async (req, res) => {
  try {
    const [users, dataset, analytics] = await Promise.all([
      storage.getUsers().then((items) => items.map((user) => ({ id: user.id, fullName: user.fullName, role: user.role, hasReportAccess: user.hasReportAccess }))),
      getAcademyDataset(),
      buildAnalytics(),
    ]);

    res.json({
      users,
      ...dataset,
      analytics,
      constants: {
        leadStatuses: LEAD_STATUSES } });
  } catch (error) {
    logger.error('Failed to fetch academy bootstrap', { error });
    res.status(500).json({ error: 'Failed to fetch academy data' });
  }
});

router.get('/analytics/dashboard', async (req, res) => {
  try {
    res.json(await buildAnalytics());
  } catch (error) {
    logger.error('Failed to fetch academy dashboard', { error });
    res.status(500).json({ error: 'Failed to fetch academy dashboard' });
  }
});

router.get('/analytics/marketing', async (req, res) => {
  if (!ensureMarketingAccess(req, res)) return;
  try {
    const analytics = await buildAnalytics();
    res.json({
      summary: analytics.summary,
      funnel: analytics.funnel,
      bySource: analytics.bySource,
      byCourse: analytics.byCourse,
      warmBaseSize: analytics.summary.warmBaseSize });
  } catch (error) {
    logger.error('Failed to fetch marketing analytics', { error });
    res.status(500).json({ error: 'Failed to fetch marketing analytics' });
  }
});

router.get('/analytics/operations', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const analytics = await buildAnalytics();
    res.json({
      summary: analytics.summary,
      groups: analytics.groups,
      risks: analytics.risks,
      byCourse: analytics.byCourse });
  } catch (error) {
    logger.error('Failed to fetch operations analytics', { error });
    res.status(500).json({ error: 'Failed to fetch operations analytics' });
  }
});

router.get('/analytics/finance', async (req, res) => {
  if (!ensureFinanceAccess(req, res)) return;
  try {
    const analytics = await buildAnalytics();
    res.json({
      summary: analytics.summary,
      byCourse: analytics.byCourse,
      bySource: analytics.bySource,
      overduePayments: analytics.risks.overduePayments });
  } catch (error) {
    logger.error('Failed to fetch finance analytics', { error });
    res.status(500).json({ error: 'Failed to fetch finance analytics' });
  }
});

router.get('/analytics/cohorts', async (req, res) => {
  try {
    const filters: string[] = [];
    const params: DbValue[] = [];
    if (req.query.courseId) {
      params.push(Number(req.query.courseId));
      filters.push(`s.course_id = $${params.length}`);
    }
    if (req.query.sourceId) {
      params.push(Number(req.query.sourceId));
      filters.push(`l.source_id = $${params.length}`);
    }
    if (req.query.managerId) {
      params.push(Number(req.query.managerId));
      filters.push(`s.manager_id = $${params.length}`);
    }
    const filterSql = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const rows = await query(
      `WITH first_payments AS (
        SELECT student_id, MIN(paid_at) AS first_paid_at
        FROM academy_payments
        WHERE status = 'paid' AND student_id IS NOT NULL
        GROUP BY student_id
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', fp.first_paid_at), 'YYYY-MM') AS cohort,
        COUNT(DISTINCT fp.student_id)::int AS students,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '2 months' THEN p.student_id END)::int AS month_2,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '3 months' THEN p.student_id END)::int AS month_3,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '4 months' THEN p.student_id END)::int AS month_4,
        COALESCE(SUM(p.amount_uzs), 0)::int AS revenue,
        COALESCE(ROUND(AVG(p.amount_uzs) * COUNT(DISTINCT fp.student_id)), 0)::int AS forecast_revenue
      FROM first_payments fp
      LEFT JOIN academy_payments p ON p.student_id = fp.student_id AND p.status = 'paid'
      LEFT JOIN academy_students s ON s.id = fp.student_id
      LEFT JOIN academy_leads l ON l.id = s.lead_id
      ${filterSql ? `WHERE ${filterSql.replace(/^AND /, '')}` : ''}
      GROUP BY 1
      ORDER BY 1 DESC`,
      params,
    );
    res.json(rows);
  } catch (error) {
    logger.error('Failed to fetch cohorts', { error });
    res.status(500).json({ error: 'Failed to fetch cohorts' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const conditions: string[] = [];
    const params: DbValue[] = [];

    if (req.query.status) {
      params.push(String(req.query.status));
      conditions.push(`l.status_code = $${params.length}`);
    }
    if (req.query.courseId) {
      params.push(Number(req.query.courseId));
      conditions.push(`l.course_id = $${params.length}`);
    }
    if (req.query.sourceId) {
      params.push(Number(req.query.sourceId));
      conditions.push(`l.source_id = $${params.length}`);
    }
    if (req.query.managerId) {
      params.push(Number(req.query.managerId));
      conditions.push(`l.manager_id = $${params.length}`);
    }
    if (req.query.warmBase === 'true') {
      conditions.push(`l.status_code = 'not_now'`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      conditions.push(`(
        LOWER(l.contact_name) LIKE $${params.length}
        OR LOWER(COALESCE(l.student_name, '')) LIKE $${params.length}
        OR LOWER(l.phone) LIKE $${params.length}
        OR LOWER(COALESCE(l.messenger, '')) LIKE $${params.length}
      )`);
    }

    const leads = await query(
      `SELECT l.*, c.name AS course_name, s.name AS source_name, u.full_name AS manager_name
       FROM academy_leads l
       LEFT JOIN academy_courses c ON c.id = l.course_id
       LEFT JOIN academy_lead_sources s ON s.id = l.source_id
       LEFT JOIN users u ON u.id = l.manager_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.created_at DESC`,
      params,
    );
    res.json(leads);
  } catch (error) {
    logger.error('Failed to fetch leads', { error });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.post('/leads', async (req, res) => {
  try {
    const contactName = nullableText(req.body.contactName);
    const phone = nullableText(req.body.phone);
    const messenger = nullableText(req.body.messenger);
    const sourceId = await resolveSourceId(req.body);

    if (!contactName) return res.status(400).json({ error: 'Имя контактного лица обязательно' });
    if (!phone) return res.status(400).json({ error: 'Телефон обязателен' });
    if (!sourceId) return res.status(400).json({ error: 'Источник обязателен' });

    const duplicate = await findDuplicate(phone, messenger);
    if (duplicate) {
      return res.status(409).json({ error: 'Duplicate lead or student', duplicate });
    }

    const studentAge = toIntegerOrNull(req.body.studentAge) as number | null | undefined;
    let courseId = parseId(req.body.courseId);
    if (!courseId && studentAge) {
      courseId = Number((await resolveCourseByAge(studentAge))?.id ?? 0) || null;
    }

    const source = await queryOne(`SELECT * FROM academy_lead_sources WHERE id = $1`, [sourceId]);
    const lead = await insertRow('academy_leads', {
      contactName,
      phone,
      messenger: messenger ?? null,
      studentName: nullableText(req.body.studentName) ?? null,
      studentAge: studentAge ?? null,
      courseId: courseId ?? null,
      sourceId,
      advertisingCampaign: nullableText(req.body.advertisingCampaign) ?? nullableText(source?.campaignName) ?? null,
      acquisitionCostUzs: normalizeMoney(req.body.acquisitionCostUzs ?? source?.costPerLeadUzs),
      statusCode: nullableText(req.body.statusCode) ?? 'new_request',
      managerId: parseId(req.body.managerId) ?? req.user!.id,
      language: nullableText(req.body.language) ?? 'ru',
      comment: nullableText(req.body.comment) ?? null,
      referralCode: nullableText(req.body.referralCode) ?? null,
      referrerStudentId: parseId(req.body.referrerStudentId),
      createdBy: req.user!.id });

    await createStageHistory(lead.id, null, lead.statusCode, req.user!.id, 'Создание лида');
    await handleLeadAutomation(req, lead);
    await createAudit(req, 'CREATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead);
    res.status(201).json(lead);
  } catch (error: any) {
    logger.error('Failed to create lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create lead' });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const [history, communications, tasks, payments] = await Promise.all([
      query(`SELECT * FROM academy_lead_stage_history WHERE lead_id = $1 ORDER BY entered_at DESC`, [id]),
      query(`SELECT * FROM academy_communications WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
      query(`SELECT * FROM academy_tasks WHERE entity_type = 'lead' AND entity_id = $1 ORDER BY deadline_at`, [id]),
      query(`SELECT * FROM academy_payments WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
    ]);
    res.json({ ...lead, history, stageDurations: buildLeadStageDurations(history), communications, tasks, payments });
  } catch (error) {
    logger.error('Failed to fetch lead', { error });
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });

    const nextStatus = nullableText(req.body.statusCode) ?? oldLead.statusCode;
    const merged = {
      nextStatus,
      studentName: nullableText(req.body.studentName) ?? oldLead.studentName,
      studentAge: toIntegerOrNull(req.body.studentAge) ?? oldLead.studentAge,
      courseId: parseId(req.body.courseId) ?? oldLead.courseId };
    const validationError = validateLeadForStatusChange(merged);
    if (validationError) return res.status(400).json({ error: validationError });

    const updates: Row = {
      contactName: nullableText(req.body.contactName),
      phone: nullableText(req.body.phone),
      messenger: nullableText(req.body.messenger),
      studentName: nullableText(req.body.studentName),
      studentAge: toIntegerOrNull(req.body.studentAge),
      courseId: parseId(req.body.courseId),
      sourceId: parseId(req.body.sourceId),
      advertisingCampaign: nullableText(req.body.advertisingCampaign),
      acquisitionCostUzs: toIntegerOrNull(req.body.acquisitionCostUzs),
      statusCode: nullableText(req.body.statusCode),
      managerId: parseId(req.body.managerId),
      language: nullableText(req.body.language),
      comment: nullableText(req.body.comment),
      firstContactAt: nullableDate(req.body.firstContactAt),
      firstContactChannel: nullableText(req.body.firstContactChannel),
      firstContactResult: nullableText(req.body.firstContactResult),
      demoAt: nullableDate(req.body.demoAt),
      demoCourseId: parseId(req.body.demoCourseId),
      demoFormat: nullableText(req.body.demoFormat),
      demoLocation: nullableText(req.body.demoLocation),
      demoAttended: req.body.demoAttended === undefined ? undefined : Boolean(req.body.demoAttended),
      demoResult: nullableText(req.body.demoResult),
      offerCourseId: parseId(req.body.offerCourseId),
      offerPriceUzs: toIntegerOrNull(req.body.offerPriceUzs),
      offerDiscount: nullableText(req.body.offerDiscount),
      offerAt: nullableDate(req.body.offerAt),
      enrolledGroupId: parseId(req.body.enrolledGroupId),
      expectedPaymentUzs: toIntegerOrNull(req.body.expectedPaymentUzs),
      paymentMethod: nullableText(req.body.paymentMethod),
      warmReason: nullableText(req.body.warmReason),
      warmMovedAt: nullableDate(req.body.warmMovedAt),
      noMailing: req.body.noMailing === undefined ? undefined : Boolean(req.body.noMailing),
      referralCode: nullableText(req.body.referralCode),
      referrerStudentId: parseId(req.body.referrerStudentId) };

    const lead = await updateRow('academy_leads', id, updates);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (oldLead.statusCode !== lead.statusCode) {
      await createStageHistory(lead.id, oldLead.statusCode, lead.statusCode, req.user!.id, nullableText(req.body.statusComment));
      await handleLeadAutomation(req, lead, oldLead.statusCode);
    }

    if (lead.statusCode === 'paid') {
      await createStudentFromLead(req, lead.id);
    }

    await createAudit(req, 'UPDATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(lead);
  } catch (error: any) {
    logger.error('Failed to update lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update lead' });
  }
});

router.post('/leads/:id/contact', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const communication = await insertRow('academy_communications', {
      leadId: id,
      channel: nullableText(req.body.channel) ?? 'call',
      result: nullableText(req.body.result) ?? null,
      comment: nullableText(req.body.comment) ?? null,
      createdBy: req.user!.id });

    const updates: Row = {
      firstContactAt: lead.firstContactAt ?? new Date(),
      firstContactChannel: nullableText(req.body.channel) ?? lead.firstContactChannel ?? 'call',
      firstContactResult: nullableText(req.body.result) ?? lead.firstContactResult ?? null };
    if (lead.statusCode === 'new_request') {
      updates.statusCode = 'first_contact';
    }

    const updatedLead = await updateRow('academy_leads', id, updates);
    if (!updatedLead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.statusCode !== updatedLead.statusCode) {
      await createStageHistory(id, lead.statusCode, updatedLead.statusCode, req.user!.id, 'Первый контакт зафиксирован');
    }

    if (String(req.body.result || '').toLowerCase().includes('не отвечает')) {
      await createTask('Повторный контакт', {
        responsibleId: updatedLead.managerId ?? req.user!.id,
        deadlineAt: addDays(new Date(), 1),
        entityType: 'lead',
        entityId: id });
    }

    res.status(201).json({ communication, lead: updatedLead });
  } catch (error) {
    logger.error('Failed to add lead contact', { error });
    res.status(500).json({ error: 'Failed to add lead contact' });
  }
});

router.post('/leads/:id/demo', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });

    const demoAt = nullableDate(req.body.demoAt);
    if (!demoAt) return res.status(400).json({ error: 'Дата и время демо обязательны' });

    const lead = await updateRow('academy_leads', id, {
      demoAt,
      demoCourseId: parseId(req.body.demoCourseId) ?? oldLead.courseId ?? null,
      demoFormat: nullableText(req.body.demoFormat) ?? 'online',
      demoLocation: nullableText(req.body.demoLocation) ?? null,
      statusCode: 'demo_invited' });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await createStageHistory(id, oldLead.statusCode, 'demo_invited', req.user!.id, 'Назначено демо');
    await handleLeadAutomation(req, lead, oldLead.statusCode);
    res.json(lead);
  } catch (error) {
    logger.error('Failed to schedule demo', { error });
    res.status(500).json({ error: 'Failed to schedule demo' });
  }
});

router.post('/leads/:id/demo-attendance', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });

    const attended = req.body.attended !== false;
    const nextStatus = attended ? 'demo_attended' : oldLead.statusCode;
    const lead = await updateRow('academy_leads', id, {
      demoAttended: attended,
      demoResult: nullableText(req.body.demoResult) ?? null,
      statusCode: nextStatus });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (oldLead.statusCode !== nextStatus) {
      await createStageHistory(id, oldLead.statusCode, nextStatus, req.user!.id, 'Отмечено посещение демо');
      await handleLeadAutomation(req, lead, oldLead.statusCode);
    }
    res.json(lead);
  } catch (error) {
    logger.error('Failed to mark demo attendance', { error });
    res.status(500).json({ error: 'Failed to mark demo attendance' });
  }
});

router.post('/leads/:id/convert-to-student', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const student = await createStudentFromLead(req, id);
    res.status(201).json(student);
  } catch (error: any) {
    logger.error('Failed to convert lead to student', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to convert lead to student' });
  }
});

router.post('/incoming/chatplace', async (req, res) => {
  try {
    const source = await getSourceByCode('instagram_dm');
    req.body.sourceId = source?.id ?? (await getDefaultSource()).id;
    const duplicate = await findDuplicate(nullableText(req.body.phone), nullableText(req.body.messenger));
    await logIntegration('chatplace', 'inbound', duplicate ? 'duplicate' : 'received', req.body);
    if (duplicate) return res.status(409).json({ error: 'Duplicate lead or student', duplicate });

    const lead = await insertRow('academy_leads', {
            contactName: nullableText(req.body.contactName) ?? nullableText(req.body.name) ?? 'Instagram lead',
      phone: nullableText(req.body.phone) ?? 'unknown',
      messenger: nullableText(req.body.messenger) ?? nullableText(req.body.instagramUsername) ?? null,
      sourceId: req.body.sourceId,
      advertisingCampaign: nullableText(req.body.campaign) ?? null,
      statusCode: 'new_request',
      managerId: req.user!.id,
      language: 'ru',
      createdBy: req.user!.id });
    await createStageHistory(lead.id, null, 'new_request', req.user!.id, 'ChatPlace');
    await handleLeadAutomation(req, lead);
    res.status(201).json(lead);
  } catch (error) {
    logger.error('Failed to receive ChatPlace lead', { error });
    res.status(500).json({ error: 'Failed to receive ChatPlace lead' });
  }
});

router.post('/incoming/google-forms', async (req, res) => {
  try {
    const source = await getSourceByCode('website');
    req.body.sourceId = source?.id ?? (await getDefaultSource()).id;
    await logIntegration('google_forms', 'inbound', 'received', req.body);
    const duplicate = await findDuplicate(nullableText(req.body.phone), nullableText(req.body.messenger));
    if (duplicate) return res.status(409).json({ error: 'Duplicate lead or student', duplicate });

    const lead = await insertRow('academy_leads', {
            contactName: nullableText(req.body.contactName) ?? nullableText(req.body.name) ?? 'Google Forms lead',
      phone: nullableText(req.body.phone) ?? 'unknown',
      studentName: nullableText(req.body.studentName) ?? null,
      courseId: parseId(req.body.courseId),
      sourceId: req.body.sourceId,
      statusCode: req.body.demoAt ? 'demo_invited' : 'new_request',
      managerId: req.user!.id,
      demoAt: nullableDate(req.body.demoAt),
      language: 'ru',
      createdBy: req.user!.id });
    await createStageHistory(lead.id, null, lead.statusCode, req.user!.id, 'Google Forms');
    await handleLeadAutomation(req, lead);
    res.status(201).json(lead);
  } catch (error) {
    logger.error('Failed to receive Google Forms lead', { error });
    res.status(500).json({ error: 'Failed to receive Google Forms lead' });
  }
});

const registerSimpleCrud = (path: string, table: string, columns: string[], options: {
  orderBy?: string;
  requireFinance?: boolean;
  requireOperations?: boolean;
  requireMarketing?: boolean;
} = {}) => {
  router.get(`/${path}`, async (req, res) => {
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const rows = await query(
        `SELECT * FROM ${quoteIdent(table)} ORDER BY ${options.orderBy ?? 'created_at DESC, id DESC'}`,
        [],
      );
      res.json(rows);
    } catch (error) {
      logger.error(`Failed to fetch ${path}`, { error });
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  router.get(`/${path}/:id`, async (req, res) => {
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const row = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
      if (!row) return res.status(404).json({ error: `${path} not found` });
      res.json(row);
    } catch (error) {
      logger.error(`Failed to fetch ${path}`, { error });
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  router.post(`/${path}`, async (req, res) => {
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const values: Row = {  };
      for (const column of columns) {
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = nullableDate(value);
        } else if (column.endsWith('Id') || column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'lessonNumber') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'courseIds' || column === 'riskFlags') {
          values[column] = safeJson(value, []);
        } else if (typeof value === 'boolean') {
          values[column] = value;
        } else {
          values[column] = nullableText(value);
        }
      }

      if (table === 'academy_groups' && values.startDate && !values.endDate) {
        const course = values.courseId
          ? await queryOne(`SELECT lesson_count FROM academy_courses WHERE id = $1`, [values.courseId as number])
          : null;
        values.endDate = deriveGroupEndDate(values.startDate as Date, Number(course?.lessonCount ?? 24));
      }

      const row = await insertRow(table, values);
      await createAudit(req, `CREATE_${table.toUpperCase()}`, table, row.id, row);
      res.status(201).json(row);
    } catch (error: any) {
      logger.error(`Failed to create ${path}`, { error });
      res.status(error.statusCode || 500).json({ error: error.message || `Failed to create ${path}` });
    }
  });

  router.patch(`/${path}/:id`, async (req, res) => {
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const oldRow = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
      if (!oldRow) return res.status(404).json({ error: `${path} not found` });
      const values: Row = {};
      for (const column of columns) {
        if (!(column in req.body)) continue;
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = nullableDate(value);
        } else if (column.endsWith('Id') || column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'lessonNumber') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'courseIds' || column === 'riskFlags') {
          values[column] = safeJson(value, []);
        } else if (typeof value === 'boolean') {
          values[column] = value;
        } else {
          values[column] = nullableText(value);
        }
      }
      const row = await updateRow(table, id, values);
      if (table === 'academy_students' && values.status !== undefined && oldRow.status !== row?.status) {
        await insertRow('academy_student_status_history', {
                    studentId: id,
          fromStatus: oldRow.status ?? null,
          toStatus: row?.status ?? String(values.status),
          changedBy: req.user!.id,
          comment: nullableText(req.body.statusComment) ?? null });
      }
      if (table === 'academy_lessons' && values.status !== undefined && oldRow.status !== row?.status) {
        await insertRow('academy_lesson_status_history', {
                    lessonId: id,
          fromStatus: oldRow.status ?? null,
          toStatus: row?.status ?? String(values.status),
          changedBy: req.user!.id,
          comment: nullableText(req.body.statusComment) ?? null });
      }
      await createAudit(req, `UPDATE_${table.toUpperCase()}`, table, id, row, oldRow);
      res.json(row);
    } catch (error: any) {
      logger.error(`Failed to update ${path}`, { error });
      res.status(error.statusCode || 500).json({ error: error.message || `Failed to update ${path}` });
    }
  });

  router.delete(`/${path}/:id`, async (req, res) => {
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      if (table === 'academy_payments') {
        const payment = await queryOne(`SELECT * FROM academy_payments WHERE id = $1`, [id]);
        if (payment?.status === 'paid' && !HEAD_ROLES.has(String(req.user?.role))) {
          return res.status(403).json({ error: 'Paid payments can be deleted only by head/admin' });
        }
      }
      await deleteRow(table, id);
      res.json({ ok: true });
    } catch (error) {
      logger.error(`Failed to delete ${path}`, { error });
      res.status(500).json({ error: `Failed to delete ${path}` });
    }
  });
};

router.post('/groups/:id/generate-lessons', async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return res.status(400).json({ error: 'Invalid group id' });
    const group = await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const existing = await query(`SELECT * FROM academy_lessons WHERE group_id = $1 ORDER BY lesson_number`, [groupId]);
    if (existing.length > 0 && req.body.force !== true) return res.json(existing);

    const course = await queryOne(`SELECT * FROM academy_courses WHERE id = $1`, [group.courseId]);
    const program = Array.isArray(course?.program) ? course.program : [];
    const lessonCount = Math.max(Number(course?.lessonCount || program.length || 1), program.length);
    const startDate = group.startDate ? new Date(group.startDate) : new Date();
    const created = [];

    for (let index = 0; index < lessonCount; index++) {
      const programLesson = program[index] ?? { lessonNumber: index + 1, topic: `Урок ${index + 1}` };
      const scheduledAt = addDays(startDate, Math.floor(index / 2) * 7 + (index % 2) * 3);
      created.push(await insertRow('academy_lessons', {
        groupId,
        courseId: group.courseId,
        teacherId: group.teacherId ?? null,
        lessonNumber: Number(programLesson.lessonNumber ?? index + 1),
        topic: programLesson.topic ?? `Урок ${index + 1}`,
        materials: programLesson.materials ?? programLesson.description ?? null,
        scheduledAt,
        durationMinutes: course?.lessonDurationMinutes ?? 120,
        status: 'scheduled' }));
    }

    res.status(201).json(created);
  } catch (error) {
    logger.error('Failed to generate lessons', { error });
    res.status(500).json({ error: 'Failed to generate lessons' });
  }
});

router.post('/lessons/:id/attendance', async (req, res) => {
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const lesson = await queryOne(
      `SELECT l.*, t.user_id AS teacher_user_id
       FROM academy_lessons l
       LEFT JOIN academy_teachers t ON t.id = l.teacher_id
       WHERE l.id = $1`,
      [lessonId],
    );
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (lesson.status === 'cancelled') return res.status(400).json({ error: 'Нельзя отметить посещаемость по отменённому занятию' });
    if (req.user!.role === 'teacher' && lesson.teacherUserId && Number(lesson.teacherUserId) !== req.user!.id) {
      return res.status(403).json({ error: 'Teacher can mark only own lessons' });
    }

    const items = Array.isArray(req.body.attendance) ? req.body.attendance : [];
    const saved = [];
    for (const item of items) {
      const studentId = parseId(item.studentId);
      if (!studentId) continue;
      const status = item.status === 'present' ? 'present' : 'absent';
      const result = await pool.query(
        `INSERT INTO academy_attendance (lesson_id, student_id, status, project_url, note, marked_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (lesson_id, student_id)
         DO UPDATE SET status = EXCLUDED.status, project_url = EXCLUDED.project_url, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, updated_at = NOW()
         RETURNING *`,
        [lessonId, studentId, status, nullableText(item.projectUrl), nullableText(item.note), req.user!.id],
      );
      saved.push(camelize(result.rows[0]));
      await recalculateStudentMetrics(studentId);

      const recentAbsences = await query<{ status: string }>(
        `SELECT COALESCE(a.status, 'absent') AS status
         FROM academy_lessons l
         LEFT JOIN academy_attendance a ON a.lesson_id = l.id AND a.student_id = $2
         WHERE l.group_id = $1 AND l.status = 'conducted'
         ORDER BY l.scheduled_at DESC
         LIMIT 3`,
        [lesson.groupId, studentId],
      );
      if (recentAbsences.length === 3 && recentAbsences.every((row) => row.status === 'absent')) {
        const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
        await createTask('3 пропуска подряд: позвонить родителю', {
          responsibleId: student?.managerId ?? req.user!.id,
          entityType: 'student',
          entityId: studentId,
          deadlineAt: addDays(new Date(), 1) });
        await createNotification(student?.managerId ?? req.user!.id, 'Риск по посещаемости', `${student?.studentName ?? 'Ученик'} пропустил 3 занятия подряд`, 'student', studentId);
      }
    }

    const updatedLesson = await updateRow('academy_lessons', lessonId, {
      status: nullableText(req.body.lessonStatus) ?? 'conducted' });

    if (updatedLesson?.status === 'conducted') {
      const students = await query(`SELECT * FROM academy_students WHERE group_id = $1 AND status = 'studying'`, [lesson.groupId]);
      for (const student of students) {
        await createOutbox(Number(student.age || 0) <= 10 ? 'whatsapp' : 'telegram', student.messenger || student.phone, 'Оцените сегодняшний урок 01 Academy: /survey', {
          scheduledAt: addMinutes(new Date(lesson.scheduledAt), Number(lesson.durationMinutes || 120) + 30),
          entityType: 'lesson',
          entityId: lessonId });
      }
    }

    res.json({ lesson: updatedLesson, attendance: saved });
  } catch (error) {
    logger.error('Failed to save attendance', { error });
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

router.post('/students/:id/transfer', async (req, res) => {
  try {
    const studentId = parseId(req.params.id);
    const toGroupId = parseId(req.body.toGroupId);
    if (!studentId || !toGroupId) return res.status(400).json({ error: 'Student and target group are required' });
    await ensureGroupCapacity(toGroupId);
    const oldStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!oldStudent) return res.status(404).json({ error: 'Student not found' });
    await insertRow('academy_student_transfers', {
      studentId,
      fromGroupId: oldStudent.groupId ?? null,
      toGroupId,
      reason: nullableText(req.body.reason) ?? null,
      createdBy: req.user!.id });
    const student = await updateRow('academy_students', studentId, { groupId: toGroupId });
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to transfer student', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to transfer student' });
  }
});

router.post('/payments', async (req, res) => {
  if (!ensureFinanceAccess(req, res)) return;
  try {
    const amountUzs = normalizeMoney(req.body.amountUzs);
    const leadId = parseId(req.body.leadId);
    const studentId = parseId(req.body.studentId);
    if (!amountUzs) return res.status(400).json({ error: 'Нельзя отметить оплату без суммы' });
    if (!leadId && !studentId) return res.status(400).json({ error: 'Нельзя отметить оплату без ученика или лида' });

    const status = nullableText(req.body.status) ?? 'paid';
    const paidAt = status === 'paid' ? nullableDate(req.body.paidAt) ?? new Date() : nullableDate(req.body.paidAt);
    const payment = await insertRow('academy_payments', {
      leadId,
      studentId,
      amountUzs,
      type: nullableText(req.body.type) ?? 'full',
      method: nullableText(req.body.method) ?? 'transfer',
      paidAt,
      period: nullableText(req.body.period) ?? 'month_1',
      discount: nullableText(req.body.discount) ?? 'none',
      status,
      dueAt: nullableDate(req.body.dueAt),
      paidUntil: nullableDate(req.body.paidUntil) ?? (status === 'paid' ? addDays(new Date(), 30) : null),
      comment: nullableText(req.body.comment),
      receiptUrl: nullableText(req.body.receiptUrl),
      confirmedBy: status === 'paid' ? req.user!.id : null });

    let student = null;
    if (status === 'paid' && leadId && !studentId) {
      student = await createStudentFromLead(req, leadId, payment.id);
    }
    const resolvedStudentId = studentId || student?.id;
    if (status === 'paid' && resolvedStudentId) {
      await updateRow('academy_students', Number(resolvedStudentId), {
        nextPaymentAt: payment.paidUntil ?? addDays(new Date(), 30) });
    }

    await createAudit(req, 'CREATE_ACADEMY_PAYMENT', 'academy_payment', payment.id, payment);
    res.status(201).json({ payment, student });
  } catch (error: any) {
    logger.error('Failed to create payment', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create payment' });
  }
});

router.post('/surveys/lesson', async (req, res) => {
  try {
    const score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be from 1 to 5' });
    const lessonId = parseId(req.body.lessonId);
    const studentId = parseId(req.body.studentId);
    if (!lessonId || !studentId) return res.status(400).json({ error: 'Lesson and student are required' });
    const lesson = await queryOne(`SELECT * FROM academy_lessons WHERE id = $1`, [lessonId]);
    const survey = await insertRow('academy_lesson_surveys', {
      studentId,
      lessonId,
      groupId: lesson?.groupId ?? parseId(req.body.groupId),
      teacherId: lesson?.teacherId ?? parseId(req.body.teacherId),
      courseId: lesson?.courseId ?? parseId(req.body.courseId),
      score,
      liked: nullableText(req.body.liked),
      improve: nullableText(req.body.improve) });
    await recalculateStudentMetrics(studentId);
    if (score < 3) {
      await createTask('Оценка урока ниже 3', {
        responsibleId: req.user!.id,
        entityType: 'student',
        entityId: studentId,
        deadlineAt: addDays(new Date(), 1) });
      await createNotification(req.user!.id, 'Низкая оценка урока', `Оценка ${score}/5`, 'student', studentId);
    }
    res.status(201).json(survey);
  } catch (error) {
    logger.error('Failed to save lesson survey', { error });
    res.status(500).json({ error: 'Failed to save lesson survey' });
  }
});

router.post('/surveys/parent', async (req, res) => {
  try {
    const studentId = parseId(req.body.studentId);
    if (!studentId) return res.status(400).json({ error: 'Student is required' });
    const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const period = nullableText(req.body.period) ?? new Date().toISOString().slice(0, 7);
    const survey = await insertRow('academy_parent_surveys', {
      studentId,
      groupId: student.groupId ?? null,
      courseId: student.courseId ?? null,
      progressAnswer: nullableText(req.body.progressAnswer),
      joyAnswer: nullableText(req.body.joyAnswer),
      continueAnswer: nullableText(req.body.continueAnswer),
      npsScore: toIntegerOrNull(req.body.npsScore),
      comment: nullableText(req.body.comment),
      period });
    await updateRow('academy_students', studentId, { parentFeedback: nullableText(req.body.comment) });
    if (['Не уверен', 'Нет', 'not_sure', 'no'].includes(String(req.body.continueAnswer))) {
      await createTask('Родитель сомневается в продолжении', {
        responsibleId: student.managerId ?? req.user!.id,
        description: 'Позвонить и узнать причину.',
        entityType: 'student',
        entityId: studentId,
        deadlineAt: addDays(new Date(), 1) });
    }
    res.status(201).json(survey);
  } catch (error) {
    logger.error('Failed to save parent survey', { error });
    res.status(500).json({ error: 'Failed to save parent survey' });
  }
});

router.get('/integrations/status', async (req, res) => {
  try {
    const logs = await query(
      `SELECT DISTINCT ON (provider) provider, status, error_message, updated_at, created_at
       FROM academy_integration_logs
       ORDER BY provider, created_at DESC`,
      [],
    );
    const providers = ['chatplace', 'telegram', 'whatsapp', 'google_forms', 'meta_ads', 'bank', 'google_sheets', 'notion'];
    res.json(providers.map((provider) => ({
      provider,
      mode: 'safe_stub',
      connected: false,
      lastLog: logs.find((log) => log.provider === provider) ?? null,
      message: 'Интеграция работает в безопасном режиме-заглушке до настройки ключей.' })));
  } catch (error) {
    logger.error('Failed to fetch integrations status', { error });
    res.status(500).json({ error: 'Failed to fetch integrations status' });
  }
});

router.post('/integrations/:provider/test', async (req, res) => {
  try {
    const log = await logIntegration(String(req.params.provider), 'outbound', 'stub_sent', req.body ?? {});
    res.json({ ok: true, mode: 'safe_stub', log });
  } catch (error) {
    logger.error('Failed to test integration', { error });
    res.status(500).json({ error: 'Failed to test integration' });
  }
});

router.post('/integrations/notion/export', async (req, res) => {
  try {
    const dataset = await getAcademyDataset();
    const payload = {
      leads: dataset.leads.length,
      students: dataset.students.length,
      payments: dataset.payments.length,
      attendance: dataset.attendance.length,
      mode: 'safe_stub' };
    const log = await logIntegration('notion', 'outbound', 'stub_exported', payload);
    res.json({
      ok: true,
      mode: 'safe_stub',
      message: 'Notion export prepared in safe stub mode. Connect a Notion token to send pages externally.',
      log,
      payload });
  } catch (error) {
    logger.error('Failed to prepare Notion export', { error });
    res.status(500).json({ error: 'Failed to prepare Notion export' });
  }
});

router.post('/reports/weekly/test', async (req, res) => {
  try {
    const analytics = await buildAnalytics();
    const recipient = nullableText(req.body.recipient) ?? 'leadership';
    const message = [
      'Еженедельный отчёт 01 Academy',
      `Новые лиды: ${analytics.summary.newLeadsWeek}`,
      `Были на демо: ${analytics.funnel.find((item) => item.code === 'demo_attended')?.count ?? 0}`,
      `Новые оплатившие: ${analytics.summary.newPaidStudents}`,
      `Выручка: ${analytics.summary.revenueMonth} сум`,
      `Средняя посещаемость: ${analytics.summary.avgAttendance}%`,
      `NPS родителей: ${analytics.summary.nps}`,
      `Красные флаги: ${analytics.risks.lowAttendanceStudents.length + analytics.risks.lowScores.length + analytics.risks.overduePayments.length + analytics.risks.longThinkingLeads.length}`,
    ].join('\n');
    const outbox = await createOutbox('telegram', recipient, message, { entityType: 'weekly_report' });
    res.json({ ok: true, outbox, preview: message });
  } catch (error) {
    logger.error('Failed to send weekly test report', { error });
    res.status(500).json({ error: 'Failed to send weekly test report' });
  }
});

router.post('/automations/run', async (req, res) => {
  try {
    const now = new Date();
    const actions: string[] = [];

    const staleLeads = await query(
      `SELECT * FROM academy_leads
       WHERE status_code <> 'not_now'
         AND status_code <> 'paid'
         AND updated_at < NOW() - INTERVAL '14 days'`,
      [],
    );

    for (const lead of staleLeads) {
      const updated = await updateRow('academy_leads', lead.id, {
        statusCode: 'not_now',
        warmMovedAt: now,
        warmReason: 'Нет ответа 14+ дней' });
      await createStageHistory(lead.id, lead.statusCode, 'not_now', req.user!.id, 'Автоматический перенос: нет ответа 14+ дней');
      actions.push(`lead:${lead.id}:not_now`);
      if (updated?.managerId) {
        await createTask('Лид автоматически перенесён в тёплую базу', {
          responsibleId: updated.managerId,
          entityType: 'lead',
          entityId: lead.id,
          deadlineAt: addDays(now, 1) });
      }
    }

    const renewalPayments = await query(
      `SELECT p.*, s.manager_id, s.phone, s.messenger, s.student_name
       FROM academy_payments p
       LEFT JOIN academy_students s ON s.id = p.student_id
       WHERE p.status = 'paid'
         AND p.paid_until BETWEEN NOW() AND NOW() + INTERVAL '5 days'`,
      [],
    );

    for (const payment of renewalPayments) {
      await createTask('Напоминание о продлении оплаты', {
        responsibleId: payment.managerId ?? req.user!.id,
        description: 'Позвонить и уточнить продление.',
        entityType: 'payment',
        entityId: payment.id,
        deadlineAt: addDays(now, 1) });
      await createOutbox('whatsapp', payment.phone || payment.messenger || 'unknown', `01 Academy: оплаченный период ${payment.studentName ?? 'ученика'} скоро заканчивается.`, {
        scheduledAt: new Date(payment.paidUntil),
        entityType: 'payment',
        entityId: payment.id });
      actions.push(`payment:${payment.id}:renewal_reminder`);
    }

    const overduePayments = await query(
      `SELECT p.*, s.manager_id
       FROM academy_payments p
       LEFT JOIN academy_students s ON s.id = p.student_id
       WHERE p.status <> 'paid'
         AND p.due_at < NOW() - INTERVAL '3 days'`,
      [],
    );

    for (const payment of overduePayments) {
      await updateRow('academy_payments', payment.id, { status: 'overdue' });
      await createTask('Просрочена оплата', {
        responsibleId: payment.managerId ?? req.user!.id,
        entityType: 'payment',
        entityId: payment.id,
        deadlineAt: addDays(now, 1) });
      actions.push(`payment:${payment.id}:overdue`);
    }

    const warmLeads = await query(
      `SELECT * FROM academy_leads
       WHERE status_code = 'not_now' AND no_mailing = false`,
      [],
    );

    for (const lead of warmLeads) {
      await createOutbox('telegram', lead.messenger || lead.phone, '01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?', {
        scheduledAt: now,
        entityType: 'lead',
        entityId: lead.id });
      await createOutbox('telegram', lead.messenger || lead.phone, '01 Academy приглашает на демо-урок. Подберём курс по возрасту.', {
        scheduledAt: addDays(now, 14),
        entityType: 'lead',
        entityId: lead.id });
      await createOutbox('whatsapp', lead.phone, 'Специальное предложение 01 Academy на этот месяц.', {
        scheduledAt: addDays(now, 30),
        entityType: 'lead',
        entityId: lead.id });
      actions.push(`lead:${lead.id}:warm_mailings`);
    }

    await logIntegration('academy_automation', 'internal', 'completed', { actions });
    res.json({ ok: true, actions });
  } catch (error) {
    logger.error('Failed to run academy automations', { error });
    res.status(500).json({ error: 'Failed to run academy automations' });
  }
});

router.post('/mailings/:id/event', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid mailing id' });
    const outbox = await queryOne(`SELECT * FROM academy_notification_outbox WHERE id = $1`, [id]);
    if (!outbox) return res.status(404).json({ error: 'Mailing not found' });

    const eventType = nullableText(req.body.eventType) ?? 'opened';
    await logIntegration(`mailing_${outbox.channel}`, 'inbound', eventType, {
      outboxId: id,
      entityType: outbox.entityType,
      entityId: outbox.entityId,
      payload: req.body });

    if (eventType === 'reply' && outbox.entityType === 'lead' && outbox.entityId) {
      const lead = await getLead(Number(outbox.entityId));
      if (lead?.statusCode === 'not_now') {
        const updated = await updateRow('academy_leads', lead.id, {
          statusCode: 'first_contact',
          warmReason: null });
        await createStageHistory(lead.id, 'not_now', 'first_contact', req.user!.id, 'Отклик на рассылку');
        await createTask('Лид откликнулся из тёплой базы', {
          responsibleId: updated?.managerId ?? req.user!.id,
          entityType: 'lead',
          entityId: lead.id,
          deadlineAt: addDays(new Date(), 1) });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Failed to record mailing event', { error });
    res.status(500).json({ error: 'Failed to record mailing event' });
  }
});

router.get('/exports/:entity', async (req, res) => {
  try {
    const entityMap: Record<string, string> = {
      leads: 'academy_leads',
      students: 'academy_students',
      payments: 'academy_payments',
      attendance: 'academy_attendance',
      surveys: 'academy_lesson_surveys',
      marketing: 'academy_marketing_expenses' };
    const table = entityMap[req.params.entity];
    if (!table) return res.status(404).json({ error: 'Export entity not found' });
    if (['payments', 'marketing'].includes(req.params.entity) && !ensureFinanceAccess(req, res)) return;
    const rows = await query(`SELECT * FROM ${quoteIdent(table)} ORDER BY id DESC`, []);
    await createAudit(req, 'EXPORT_ACADEMY_DATA', req.params.entity, 0, { count: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`);
    res.send(createCsv(rows));
  } catch (error) {
    logger.error('Failed to export academy data', { error });
    res.status(500).json({ error: 'Failed to export academy data' });
  }
});

registerSimpleCrud('courses', 'academy_courses', [
  'name', 'slug', 'ageCategory', 'lessonCount', 'lessonDurationMinutes', 'frequency',
  'basePriceUzs', 'discountedPriceUzs', 'ltvTargetMinUzs', 'ltvTargetMaxUzs', 'program', 'isActive',
], { orderBy: 'name' });

registerSimpleCrud('sources', 'academy_lead_sources', [
  'code', 'name', 'channel', 'campaignName', 'costPerLeadUzs', 'isSystem', 'isActive',
], { orderBy: 'name', requireMarketing: true });

registerSimpleCrud('teachers', 'academy_teachers', [
  'userId', 'fullName', 'courseIds', 'schedule', 'status',
], { orderBy: 'full_name', requireOperations: true });

registerSimpleCrud('groups', 'academy_groups', [
  'name', 'courseId', 'teacherId', 'schedule', 'maxStudents', 'status', 'startDate', 'endDate',
], { orderBy: 'created_at DESC', requireOperations: true });

registerSimpleCrud('students', 'academy_students', [
  'leadId', 'contactName', 'phone', 'messenger', 'studentName', 'age', 'courseId', 'groupId',
  'managerId', 'enrolledAt', 'status', 'attendancePercent', 'progressPercent', 'satisfactionAvg',
  'parentFeedback', 'nextPaymentAt', 'referralCode', 'marketingConsent', 'riskFlags',
], { orderBy: 'created_at DESC' });

registerSimpleCrud('lessons', 'academy_lessons', [
  'groupId', 'courseId', 'teacherId', 'lessonNumber', 'topic', 'materials', 'scheduledAt', 'durationMinutes', 'status',
], { orderBy: 'scheduled_at DESC', requireOperations: true });

registerSimpleCrud('payments', 'academy_payments', [
  'leadId', 'studentId', 'amountUzs', 'type', 'method', 'paidAt', 'period', 'discount', 'status',
  'dueAt', 'paidUntil', 'comment', 'receiptUrl', 'confirmedBy',
], { orderBy: 'created_at DESC', requireFinance: true });

registerSimpleCrud('tasks', 'academy_tasks', [
  'title', 'description', 'responsibleId', 'deadlineAt', 'status', 'entityType', 'entityId', 'completedAt',
], { orderBy: 'COALESCE(deadline_at, created_at)' });

registerSimpleCrud('expenses', 'academy_marketing_expenses', [
  'sourceId', 'channel', 'campaignName', 'periodStart', 'periodEnd', 'amountUzs', 'createdBy',
], { orderBy: 'period_start DESC', requireFinance: true });

registerSimpleCrud('portfolio', 'academy_portfolio_projects', [
  'studentId', 'lessonId', 'groupId', 'courseId', 'title', 'url', 'fileUrl', 'finalStatus', 'marketingConsent',
], { orderBy: 'created_at DESC' });

registerSimpleCrud('referrals', 'academy_referral_rewards', [
  'referrerStudentId', 'referredLeadId', 'referredStudentId', 'rewardType', 'rewardValue', 'status', 'appliedAt',
], { orderBy: 'created_at DESC' });

export default router;
