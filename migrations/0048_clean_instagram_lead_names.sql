-- Replace the legacy ChatPlace/Meta placeholder with the best Instagram
-- identity already stored in CRM. Existing manager assignments are preserved.
WITH latest_conversation_identity AS (
  SELECT DISTINCT ON (conversation.lead_id)
    conversation.lead_id,
    NULLIF(BTRIM(conversation.participant_name), '') AS participant_name,
    NULLIF(BTRIM(conversation.participant_username), '') AS participant_username,
    conversation.participant_igsid
  FROM instagram_conversations conversation
  WHERE conversation.lead_id IS NOT NULL
  ORDER BY conversation.lead_id, conversation.updated_at DESC, conversation.id DESC
), replacements AS (
  SELECT
    lead.id AS lead_id,
    COALESCE(
      identity.participant_name,
      CASE
        WHEN identity.participant_username IS NOT NULL
          THEN LEFT('@' || LTRIM(identity.participant_username, '@'), 255)
      END,
      CASE
        WHEN NULLIF(BTRIM(lead.messenger), '') IS NOT NULL
          AND BTRIM(lead.messenger) NOT ILIKE 'instagram:%'
          THEN LEFT(BTRIM(lead.messenger), 255)
      END,
      CASE
        WHEN identity.participant_igsid IS NOT NULL
          THEN LEFT('Instagram #' || identity.participant_igsid, 255)
      END,
      'Instagram'
    ) AS contact_name
  FROM academy_leads lead
  JOIN academy_lead_sources source ON source.id = lead.source_id
  LEFT JOIN latest_conversation_identity identity ON identity.lead_id = lead.id
  WHERE source.channel = 'instagram'
    AND LOWER(BTRIM(lead.contact_name)) = 'instagram lead'
)
UPDATE academy_leads lead
SET contact_name = replacements.contact_name,
    updated_at = NOW()
FROM replacements
WHERE lead.id = replacements.lead_id;
