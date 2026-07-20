WITH duplicate_pairs AS (
  SELECT DISTINCT ON (legacy_channel.id)
    legacy_channel.id AS legacy_id,
    provider_channel.id AS provider_id
  FROM academy_lead_channels legacy_channel
  JOIN academy_lead_channels provider_channel
    ON provider_channel.lead_id = legacy_channel.lead_id
   AND provider_channel.channel = legacy_channel.channel
   AND provider_channel.id <> legacy_channel.id
   AND provider_channel.provider_account_id <> ''
   AND (
     (
       legacy_channel.external_id IS NOT NULL
       AND provider_channel.external_id IS NOT NULL
       AND legacy_channel.external_id = provider_channel.external_id
     )
     OR (
       legacy_channel.handle IS NOT NULL
       AND provider_channel.handle IS NOT NULL
       AND LOWER(REGEXP_REPLACE(legacy_channel.handle, '^@+', ''))
         = LOWER(REGEXP_REPLACE(provider_channel.handle, '^@+', ''))
     )
   )
  WHERE legacy_channel.channel = 'instagram'
    AND legacy_channel.provider_account_id = ''
    AND legacy_channel.metadata ->> 'backfilledFrom' = 'lead'
  ORDER BY legacy_channel.id,
           (provider_channel.external_id IS NOT NULL) DESC,
           provider_channel.updated_at DESC,
           provider_channel.id DESC
)
UPDATE academy_lead_channels provider_channel
SET display_name = COALESCE(provider_channel.display_name, legacy_channel.display_name),
    profile_url = COALESCE(provider_channel.profile_url, legacy_channel.profile_url),
    metadata = legacy_channel.metadata || provider_channel.metadata,
    updated_at = NOW()
FROM duplicate_pairs pair
JOIN academy_lead_channels legacy_channel ON legacy_channel.id = pair.legacy_id
WHERE provider_channel.id = pair.provider_id;

DELETE FROM academy_lead_channels legacy_channel
USING academy_lead_channels provider_channel
WHERE legacy_channel.channel = 'instagram'
  AND legacy_channel.provider_account_id = ''
  AND legacy_channel.metadata ->> 'backfilledFrom' = 'lead'
  AND provider_channel.lead_id = legacy_channel.lead_id
  AND provider_channel.channel = legacy_channel.channel
  AND provider_channel.id <> legacy_channel.id
  AND provider_channel.provider_account_id <> ''
  AND (
    (
      legacy_channel.external_id IS NOT NULL
      AND provider_channel.external_id IS NOT NULL
      AND legacy_channel.external_id = provider_channel.external_id
    )
    OR (
      legacy_channel.handle IS NOT NULL
      AND provider_channel.handle IS NOT NULL
      AND LOWER(REGEXP_REPLACE(legacy_channel.handle, '^@+', ''))
        = LOWER(REGEXP_REPLACE(provider_channel.handle, '^@+', ''))
    )
  );
