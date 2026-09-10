import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { SalesFunnelRole } from '../../../shared/sales-funnel-workflow';

export function createSalesFunnelTables(user: AnyPgColumn) {
  const academySalesFunnels = pgTable('academy_sales_funnels', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    workflowRole: varchar('workflow_role', { length: 20 }).$type<SalesFunnelRole>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }, (table) => ({
    normalizedNameUnique: uniqueIndex('academy_sales_funnels_name_unique').on(sql`lower(BTRIM(${table.name}))`),
    defaultUnique: uniqueIndex('academy_sales_funnels_default_unique')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    nameNotBlank: check('academy_sales_funnels_name_not_blank', sql`BTRIM(${table.name}) <> ''`),
    workflowRoleUnique: uniqueIndex('academy_sales_funnels_workflow_role_unique')
      .on(table.workflowRole).where(sql`${table.workflowRole} IS NOT NULL`),
    workflowRoleCheck: check('academy_sales_funnels_workflow_role_check', sql`${table.workflowRole} IN ('hunter', 'closer')`),
  }));

  const academyIntegrationFunnelSettings = pgTable('academy_integration_funnel_settings', {
    provider: varchar('provider', { length: 80 }).primaryKey(),
    funnelId: integer('funnel_id').references(() => academySalesFunnels.id, { onDelete: 'restrict' }).notNull(),
    updatedBy: integer('updated_by').references(() => user, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }, (table) => ({
    funnelIdx: index('academy_integration_funnel_settings_funnel_idx').on(table.funnelId),
    providerCheck: check(
      'academy_integration_funnel_settings_provider_check',
      sql`${table.provider} IN ('instagram', 'meta', 'onlinepbx')
        OR ${table.provider} ~ '^website:[a-z0-9]([a-z0-9.-]{0,69}[a-z0-9])?$'`,
    ),
  }));

  return { academySalesFunnels, academyIntegrationFunnelSettings };
}

export function createLeadFunnelHandoffTable(ref: {
  lead: AnyPgColumn; funnel: AnyPgColumn; user: AnyPgColumn; demo: AnyPgColumn;
}) {
  return pgTable('academy_lead_funnel_handoffs', {
    leadId: integer('lead_id').primaryKey().references(() => ref.lead, { onDelete: 'cascade' }),
    fromFunnelId: integer('from_funnel_id').notNull().references(() => ref.funnel, { onDelete: 'restrict' }),
    fromManagerId: integer('from_manager_id').references(() => ref.user, { onDelete: 'set null' }),
    demoLessonId: integer('demo_lesson_id').references(() => ref.demo, { onDelete: 'set null' }),
    handedOffAt: timestamp('handed_off_at').notNull().default(sql`timezone('UTC', now())`),
    returnedAt: timestamp('returned_at'),
  });
}
