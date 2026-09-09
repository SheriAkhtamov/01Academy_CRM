import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';

export function createSalesFunnelTables(user: AnyPgColumn) {
  const academySalesFunnels = pgTable('academy_sales_funnels', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }, (table) => ({
    normalizedNameUnique: uniqueIndex('academy_sales_funnels_name_unique').on(sql`lower(BTRIM(${table.name}))`),
    defaultUnique: uniqueIndex('academy_sales_funnels_default_unique')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    nameNotBlank: check('academy_sales_funnels_name_not_blank', sql`BTRIM(${table.name}) <> ''`),
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
      sql`${table.provider} IN ('website', 'instagram', 'meta', 'onlinepbx')`,
    ),
  }));

  return { academySalesFunnels, academyIntegrationFunnelSettings };
}
