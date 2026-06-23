-- Demo sources were previously recreated by the deployment seed command. Keep any
-- historical links intact, but make those records unavailable for new leads and UI.
UPDATE "academy_lead_sources" AS sources
SET
  "is_active" = false,
  "is_system" = false,
  "updated_at" = NOW()
WHERE sources."code" IN (
  'instagram_dm',
  'instagram_ad_default',
  'instagram_reels',
  'tiktok',
  'telegram_channel',
  'telegram_chat',
  'telegram_ad',
  'blogger_default',
  'school_default',
  'event_default',
  'referral_default',
  'website',
  'organic'
)
AND (
  EXISTS (SELECT 1 FROM "academy_leads" leads WHERE leads."source_id" = sources."id")
  OR EXISTS (SELECT 1 FROM "academy_marketing_expenses" expenses WHERE expenses."source_id" = sources."id")
  OR EXISTS (SELECT 1 FROM "instagram_accounts" accounts WHERE accounts."source_id" = sources."id")
);
--> statement-breakpoint
DELETE FROM "academy_lead_sources" AS sources
WHERE sources."code" IN (
  'instagram_dm',
  'instagram_ad_default',
  'instagram_reels',
  'tiktok',
  'telegram_channel',
  'telegram_chat',
  'telegram_ad',
  'blogger_default',
  'school_default',
  'event_default',
  'referral_default',
  'website',
  'organic'
)
AND NOT EXISTS (SELECT 1 FROM "academy_leads" leads WHERE leads."source_id" = sources."id")
AND NOT EXISTS (SELECT 1 FROM "academy_marketing_expenses" expenses WHERE expenses."source_id" = sources."id")
AND NOT EXISTS (SELECT 1 FROM "instagram_accounts" accounts WHERE accounts."source_id" = sources."id");
