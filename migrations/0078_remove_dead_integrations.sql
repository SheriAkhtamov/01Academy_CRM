-- Retire every unsupported external channel while preserving historical lead rows.
UPDATE "academy_lead_sources"
SET "is_active" = false,
    "is_system" = false,
    "updated_at" = NOW()
WHERE LOWER("code") IN ('telegram', 'whatsapp', 'threads', 'facebook')
   OR LOWER(COALESCE("channel", '')) IN ('telegram', 'whatsapp', 'threads', 'facebook');
--> statement-breakpoint
DELETE FROM "academy_lead_channels"
WHERE LOWER("channel") IN ('telegram', 'whatsapp', 'threads', 'facebook');
--> statement-breakpoint
DELETE FROM "academy_integration_logs"
WHERE LOWER("provider") IN (
  'telegram',
  'whatsapp',
  'threads',
  'chatplace',
  'google_forms',
  'google_sheets',
  'notion'
);
--> statement-breakpoint
DELETE FROM "academy_lead_sources" source
WHERE (
    LOWER(source."code") IN ('telegram', 'whatsapp', 'threads', 'facebook')
    OR LOWER(COALESCE(source."channel", '')) IN ('telegram', 'whatsapp', 'threads', 'facebook')
  )
  AND NOT EXISTS (SELECT 1 FROM "academy_leads" lead WHERE lead."source_id" = source."id")
  AND NOT EXISTS (SELECT 1 FROM "academy_marketing_expenses" expense WHERE expense."source_id" = source."id")
  AND NOT EXISTS (SELECT 1 FROM "instagram_accounts" account WHERE account."source_id" = source."id");
--> statement-breakpoint
DROP TABLE IF EXISTS "academy_notification_outbox";
