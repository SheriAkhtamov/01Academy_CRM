import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { KpiPlanConfig, KpiRole, KpiSaleKind } from '../../../shared/sales-kpi';

export function createSalesKpiTables(ref: {
  user: AnyPgColumn; lead: AnyPgColumn; participant: AnyPgColumn;
  payment: AnyPgColumn; survey: AnyPgColumn;
}) {
  const owner = (name: string) => integer(name).references(() => ref.user, { onDelete: 'set null' });
  const createdAt = () => timestamp('created_at').notNull().default(sql`timezone('UTC', now())`);
  const academySalesKpiMeta = pgTable('academy_sales_kpi_meta', {
    id: integer('id').primaryKey(),
    trackingStartedAt: timestamp('tracking_started_at').notNull().default(sql`timezone('UTC', now())`),
  }, (t) => [check('academy_sales_kpi_meta_id_check', sql`${t.id} = 1`)]);
  const academySalesKpiPlans = pgTable('academy_sales_kpi_plans', {
    id: serial('id').primaryKey(), role: text('role').$type<KpiRole>().notNull(),
    effectiveMonth: text('effective_month').notNull(), config: jsonb('config').$type<KpiPlanConfig>().notNull(),
    createdBy: owner('created_by'), createdAt: createdAt(),
  }, (t) => [
    index('academy_sales_kpi_plans_version_idx').on(t.role, t.effectiveMonth.desc(), t.id.desc()),
    check('academy_sales_kpi_plans_role_check', sql`${t.role} IN ('hunter', 'closer', 'full_cycle')`),
    check('academy_sales_kpi_plans_effective_month_check', sql`${t.effectiveMonth} ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'`),
    check('academy_sales_kpi_plans_config_check', sql`jsonb_typeof(${t.config}) = 'object'`),
  ]);
  const academySalesKpiAssignments = pgTable('academy_sales_kpi_assignments', {
    userId: integer('user_id').notNull().references(() => ref.user, { onDelete: 'cascade' }),
    effectiveMonth: text('effective_month').notNull(), role: text('role').$type<KpiRole>(),
    createdBy: owner('created_by'), createdAt: createdAt(),
  }, (t) => [
    primaryKey({ columns: [t.userId, t.effectiveMonth] }),
    check('academy_sales_kpi_assignments_role_check', sql`${t.role} IN ('hunter', 'closer', 'full_cycle')`),
    check('academy_sales_kpi_assignments_effective_month_check', sql`${t.effectiveMonth} ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'`),
  ]);
  const academySalesKpiLeads = pgTable('academy_sales_kpi_leads', {
    leadId: integer('lead_id').primaryKey().references(() => ref.lead, { onDelete: 'cascade' }),
    hunterId: owner('hunter_id'), closerId: owner('closer_id'),
    receivedAt: timestamp('received_at').notNull(), trackedAt: timestamp('tracked_at').notNull(),
    firstResponseAt: timestamp('first_response_at'), qualifiedAt: timestamp('qualified_at'),
    crmCompletedAt: timestamp('crm_completed_at'), offerAt: timestamp('offer_at'),
    reactivatedAt: timestamp('reactivated_at'), createdAt: createdAt(),
  }, (t) => [
    index('academy_sales_kpi_leads_hunter_idx').on(t.hunterId, t.receivedAt),
    index('academy_sales_kpi_leads_closer_idx').on(t.closerId),
  ]);
  const academySalesKpiActivity = pgTable('academy_sales_kpi_activity', {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id').notNull().references(() => ref.lead, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), sourceKey: text('source_key').notNull().unique(),
    occurredAt: timestamp('occurred_at').notNull().default(sql`timezone('UTC', now())`),
  }, (t) => [
    index('academy_sales_kpi_activity_lead_idx').on(t.leadId, t.occurredAt.desc(), t.id.desc()),
    check('academy_sales_kpi_activity_kind_check', sql`${t.kind} IN ('contact', 'cold', 'reactivated')`),
  ]);
  const academySalesKpiTrials = pgTable('academy_sales_kpi_trials', {
    participantId: integer('participant_id').primaryKey().references(() => ref.participant, { onDelete: 'cascade' }),
    hunterId: owner('hunter_id'), closerId: owner('closer_id'),
    bookedAt: timestamp('booked_at').notNull().default(sql`timezone('UTC', now())`),
    reactivated: boolean('reactivated').notNull().default(false),
  }, (t) => [index('academy_sales_kpi_trials_hunter_idx').on(t.hunterId), index('academy_sales_kpi_trials_closer_idx').on(t.closerId)]);
  const academySalesKpiSales = pgTable('academy_sales_kpi_sales', {
    paymentId: integer('payment_id').primaryKey().references(() => ref.payment, { onDelete: 'cascade' }),
    closerId: owner('closer_id'), kind: text('kind').$type<KpiSaleKind>().notNull(),
    cycleKey: text('cycle_key'), referralInitiated: boolean('referral_initiated').notNull().default(false),
    reviewedBy: owner('reviewed_by'), reviewedAt: timestamp('reviewed_at'), createdAt: createdAt(),
  }, (t) => [
    index('academy_sales_kpi_sales_closer_idx').on(t.closerId),
    check('academy_sales_kpi_sales_kind_check', sql`${t.kind} IN ('new', 'renewal', 'upsell', 'installment', 'unclassified')`),
    check('academy_sales_kpi_sales_cycle_key_check', sql`${t.cycleKey} IS NULL OR length(${t.cycleKey}) BETWEEN 1 AND 120`),
    check('academy_sales_kpi_sales_check', sql`${t.kind} NOT IN ('renewal', 'upsell') OR ${t.cycleKey} IS NOT NULL`),
  ]);
  const academySalesKpiSurveys = pgTable('academy_sales_kpi_surveys', {
    surveyId: integer('survey_id').primaryKey().references(() => ref.survey, { onDelete: 'cascade' }),
    closerId: owner('closer_id'),
  });
  return { academySalesKpiMeta, academySalesKpiPlans, academySalesKpiAssignments, academySalesKpiLeads,
    academySalesKpiActivity, academySalesKpiTrials, academySalesKpiSales, academySalesKpiSurveys };
}
