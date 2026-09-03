INSERT INTO "academy_lead_sources" (
  "code",
  "name",
  "channel",
  "is_system",
  "is_active",
  "updated_at"
)
VALUES ('telegram', 'Telegram', 'telegram', true, true, NOW())
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "channel" = EXCLUDED."channel",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = NOW();
