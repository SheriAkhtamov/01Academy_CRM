ALTER TABLE "academy_integration_funnel_settings"
DROP CONSTRAINT "academy_integration_funnel_settings_provider_check";
--> statement-breakpoint
INSERT INTO "academy_integration_funnel_settings" (
  "provider",
  "funnel_id",
  "updated_by",
  "created_at",
  "updated_at"
)
SELECT site."provider",
       legacy."funnel_id",
       legacy."updated_by",
       legacy."created_at",
       NOW()
FROM "academy_integration_funnel_settings" legacy
CROSS JOIN (VALUES
  ('website:01academy.uz'),
  ('website:01academy.pro')
) AS site("provider")
WHERE legacy."provider" = 'website'
ON CONFLICT ("provider") DO NOTHING;
--> statement-breakpoint
DELETE FROM "academy_integration_funnel_settings"
WHERE "provider" = 'website';
--> statement-breakpoint
ALTER TABLE "academy_integration_funnel_settings"
ADD CONSTRAINT "academy_integration_funnel_settings_provider_check"
CHECK (
  "provider" IN ('instagram', 'meta', 'onlinepbx')
  OR "provider" ~ '^website:[a-z0-9]([a-z0-9.-]{0,69}[a-z0-9])?$'
);
--> statement-breakpoint
INSERT INTO "academy_lead_sources" (
  "code",
  "name",
  "channel",
  "is_system",
  "is_active",
  "created_at",
  "updated_at"
)
VALUES
  ('website:01academy.uz', '01academy.uz', 'website', true, true, NOW(), NOW()),
  ('website:01academy.pro', '01academy.pro', 'website', true, true, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "channel" = EXCLUDED."channel",
    "is_system" = true,
    "is_active" = true,
    "updated_at" = NOW();
--> statement-breakpoint
WITH website_events AS (
  SELECT CASE
           WHEN COALESCE(log."payload"->>'siteDomain', '') ILIKE '%01academy.pro%'
             OR COALESCE(log."payload"->>'pageUrl', log."payload"->>'page', '') ILIKE '%01academy.pro%'
             THEN '01academy.pro'
           WHEN COALESCE(log."payload"->>'siteDomain', '') ILIKE '%01academy.uz%'
             OR COALESCE(log."payload"->>'pageUrl', log."payload"->>'page', '') ILIKE '%01academy.uz%'
             THEN '01academy.uz'
           ELSE NULL
         END AS site_domain,
         NULLIF(
           REGEXP_REPLACE(
             COALESCE(
               log."payload"->>'phone',
               CASE
                 WHEN COALESCE(log."payload"->>'contact', '') !~* '[a-z_]'
                   THEN log."payload"->>'contact'
                 ELSE NULL
               END,
               ''
             ),
             '\D',
             '',
             'g'
           ),
           ''
         ) AS phone_digits,
         NULLIF(
           LOWER(
             REGEXP_REPLACE(
               REGEXP_REPLACE(
                 COALESCE(
                   log."payload"->>'messenger',
                   CASE
                     WHEN COALESCE(log."payload"->>'contact', '') ~* '[@a-z_]|t[.]me'
                       THEN log."payload"->>'contact'
                     ELSE NULL
                   END,
                   ''
                 ),
                 '^https?://(www[.])?(t[.]me|telegram[.]me)/',
                 '',
                 'i'
               ),
               '^@',
               ''
             )
           ),
           ''
         ) AS messenger,
         NULLIF(LOWER(BTRIM(COALESCE(log."payload"->>'contactName', log."payload"->>'name', ''))), '') AS contact_name,
         log."created_at"
  FROM "academy_integration_logs" log
  WHERE log."provider" = 'website'
), classified_leads AS (
  SELECT lead."id",
         COALESCE(
           CASE
             WHEN COALESCE(lead."advertising_campaign", '') ILIKE '%01academy.pro%'
               OR COALESCE(lead."comment", '') ILIKE '%01academy.pro%'
               THEN '01academy.pro'
             WHEN COALESCE(lead."advertising_campaign", '') ILIKE '%01academy.uz%'
               OR COALESCE(lead."comment", '') ILIKE '%01academy.uz%'
               THEN '01academy.uz'
             ELSE NULL
           END,
           matched_event.site_domain
         ) AS site_domain
  FROM "academy_leads" lead
  JOIN "academy_lead_sources" legacy_source
    ON legacy_source."id" = lead."source_id"
   AND legacy_source."code" = 'website'
  LEFT JOIN LATERAL (
    SELECT event.site_domain
    FROM website_events event
    WHERE event.site_domain IS NOT NULL
      AND (
        (
          event.phone_digits IS NOT NULL
          AND REGEXP_REPLACE(COALESCE(lead."phone", ''), '\D', '', 'g') = event.phone_digits
        )
        OR (
          event.messenger IS NOT NULL
          AND LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                COALESCE(lead."messenger", ''),
                '^https?://(www[.])?(t[.]me|telegram[.]me)/',
                '',
                'i'
              ),
              '^@',
              ''
            )
          ) = event.messenger
        )
        OR (
          event.contact_name IS NOT NULL
          AND LOWER(BTRIM(COALESCE(lead."contact_name", ''))) = event.contact_name
        )
      )
    ORDER BY ABS(EXTRACT(EPOCH FROM (event."created_at" - lead."created_at")))
    LIMIT 1
  ) matched_event ON true
), source_assignments AS (
  SELECT classified."id" AS lead_id,
         source."id" AS source_id
  FROM classified_leads classified
  JOIN "academy_lead_sources" source
    ON source."code" = 'website:' || classified.site_domain
  WHERE classified.site_domain IS NOT NULL
)
UPDATE "academy_leads" lead
SET "source_id" = assignment.source_id,
    "updated_at" = NOW()
FROM source_assignments assignment
WHERE lead."id" = assignment.lead_id;
--> statement-breakpoint
UPDATE "academy_lead_sources"
SET "name" = 'Неопределённый сайт',
    "is_active" = false,
    "updated_at" = NOW()
WHERE "code" = 'website';
--> statement-breakpoint
WITH classified_logs AS (
  SELECT log."id",
         CASE
           WHEN COALESCE(log."payload"->>'siteDomain', '') ILIKE '%01academy.pro%'
             OR COALESCE(log."payload"->>'pageUrl', log."payload"->>'page', '') ILIKE '%01academy.pro%'
             THEN '01academy.pro'
           WHEN COALESCE(log."payload"->>'siteDomain', '') ILIKE '%01academy.uz%'
             OR COALESCE(log."payload"->>'pageUrl', log."payload"->>'page', '') ILIKE '%01academy.uz%'
             THEN '01academy.uz'
           ELSE NULL
         END AS site_domain
  FROM "academy_integration_logs" log
  WHERE log."provider" = 'website'
)
UPDATE "academy_integration_logs" log
SET "provider" = 'website:' || classified.site_domain,
    "payload" = JSONB_SET(
      COALESCE(log."payload", '{}'::jsonb),
      '{siteDomain}',
      TO_JSONB(classified.site_domain),
      true
    ),
    "updated_at" = NOW()
FROM classified_logs classified
WHERE log."id" = classified."id"
  AND classified.site_domain IS NOT NULL;
