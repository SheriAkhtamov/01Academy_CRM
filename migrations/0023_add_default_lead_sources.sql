INSERT INTO "academy_lead_sources" ("code", "name", "channel", "is_system", "is_active", "updated_at")
VALUES
  ('telegram', 'Telegram', 'telegram', true, true, NOW()),
  ('instagram', 'Instagram', 'instagram', true, true, NOW()),
  ('referral', 'Рекомендация знакомых', 'referral', true, true, NOW()),
  ('website', 'Сайт', 'website', true, true, NOW()),
  ('facebook', 'Facebook', 'facebook', true, true, NOW())
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "channel" = EXCLUDED."channel",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = NOW();
--> statement-breakpoint
DROP INDEX IF EXISTS "instagram_accounts_source_unique";
--> statement-breakpoint
UPDATE "instagram_accounts" AS accounts
SET
  "source_id" = sources."id",
  "updated_at" = NOW()
FROM "academy_lead_sources" AS sources
WHERE sources."code" = 'instagram'
  AND accounts."source_id" <> sources."id";
