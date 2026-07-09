-- Extract Uzbekistan phone numbers sent by clients in Instagram Direct, attach
-- them to their leads, and merge automatically imported Instagram leads into a
-- pre-existing lead that already owns the same phone number.
--
-- Safety rules:
--   * only inbound messages are parsed;
--   * a number must be a valid Uzbekistan mobile number in either local
--     9-digit or +998 / 00998 form;
--   * an existing lead that owns the number is always retained, preserving its
--     sales stage, manager, and commercial data;
--   * an auto-created `instagram:*` lead is archived after all linked records
--     and conversations have moved to the retained lead.

CREATE TEMP TABLE instagram_phone_candidates ON COMMIT DROP AS
WITH matches AS (
  SELECT
    c.id AS conversation_id,
    c.lead_id AS source_lead_id,
    m.id AS message_id,
    m.created_at AS message_created_at,
    regexp_replace(match[1], '[^0-9]', '', 'g') AS digits
  FROM instagram_messages m
  JOIN instagram_conversations c ON c.id = m.conversation_id
  CROSS JOIN LATERAL regexp_matches(
    m.content,
    '(?<![[:alnum:]])((?:(?:\+?998|00998)[[:space:].()_-]*)?[0-9](?:[[:space:].()_-]*[0-9]){8})(?![[:alnum:]])',
    'g'
  ) AS match
  WHERE m.direction = 'inbound'
    AND c.lead_id IS NOT NULL
), normalized AS (
  SELECT
    *,
    CASE
      WHEN length(digits) = 9 THEN '+998' || digits
      WHEN length(digits) = 12 AND left(digits, 3) = '998' THEN '+' || digits
      ELSE NULL
    END AS normalized_phone
  FROM matches
), valid_numbers AS (
  SELECT *
  FROM normalized
  WHERE normalized_phone IS NOT NULL
    AND substring(normalized_phone FROM 5 FOR 2) IN (
      '20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'
    )
)
SELECT DISTINCT ON (normalized_phone, conversation_id)
  normalized_phone,
  conversation_id,
  source_lead_id,
  message_id,
  message_created_at
FROM valid_numbers
ORDER BY normalized_phone, conversation_id, message_created_at, message_id;
--> statement-breakpoint

CREATE TEMP TABLE instagram_phone_targets ON COMMIT DROP AS
SELECT DISTINCT ON (candidate.normalized_phone)
  candidate.normalized_phone,
  candidate.conversation_id,
  candidate.source_lead_id,
  candidate.message_id,
  candidate.message_created_at,
  COALESCE(phone_owner.lead_id, legacy_phone_owner.id, candidate.source_lead_id) AS canonical_lead_id
FROM instagram_phone_candidates candidate
LEFT JOIN LATERAL (
  SELECT lead_id
  FROM academy_lead_phones
  WHERE normalized_phone = candidate.normalized_phone
  LIMIT 1
) phone_owner ON true
LEFT JOIN LATERAL (
  SELECT l.id
  FROM academy_leads l
  WHERE CASE
    WHEN length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) = 9
      THEN '+998' || regexp_replace(l.phone, '[^0-9]', '', 'g')
    WHEN length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) = 12
      AND left(regexp_replace(l.phone, '[^0-9]', '', 'g'), 3) = '998'
      THEN '+' || regexp_replace(l.phone, '[^0-9]', '', 'g')
    ELSE NULL
  END = candidate.normalized_phone
  ORDER BY
    CASE WHEN l.is_archived THEN 1 ELSE 0 END,
    CASE WHEN l.phone LIKE 'instagram:%' THEN 1 ELSE 0 END,
    l.created_at,
    l.id
  LIMIT 1
) legacy_phone_owner ON phone_owner.lead_id IS NULL
ORDER BY
  candidate.normalized_phone,
  CASE
    WHEN phone_owner.lead_id IS NOT NULL THEN 0
    WHEN legacy_phone_owner.id IS NOT NULL THEN 1
    ELSE 2
  END,
  candidate.message_created_at,
  candidate.message_id;
--> statement-breakpoint

-- A source lead is merged only if all of its extracted phone numbers resolve
-- to one retained lead. This prevents one imported conversation with multiple
-- contacts from being silently merged into unrelated leads.
CREATE TEMP TABLE instagram_lead_merge_map ON COMMIT DROP AS
SELECT
  target.source_lead_id,
  min(target.canonical_lead_id) AS canonical_lead_id
FROM instagram_phone_targets target
JOIN academy_leads source ON source.id = target.source_lead_id
WHERE target.source_lead_id <> target.canonical_lead_id
  AND source.phone LIKE 'instagram:%'
GROUP BY target.source_lead_id
HAVING count(DISTINCT target.canonical_lead_id) = 1;
--> statement-breakpoint

CREATE TEMP TABLE instagram_canonical_phone_updates ON COMMIT DROP AS
SELECT DISTINCT ON (canonical_lead_id)
  canonical_lead_id,
  normalized_phone
FROM instagram_phone_targets
ORDER BY canonical_lead_id, message_created_at, message_id;
--> statement-breakpoint

-- Retain the history and every Instagram thread on the manually created lead.
UPDATE instagram_conversations conversation
SET lead_id = merge.canonical_lead_id,
    updated_at = NOW()
FROM instagram_lead_merge_map merge
WHERE conversation.lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_communications communication
SET lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE communication.lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_lead_assignment_history history
SET lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE history.lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_lead_stage_history history
SET lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE history.lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_payments payment
SET lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE payment.lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_referral_rewards reward
SET referred_lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE reward.referred_lead_id = merge.source_lead_id;
--> statement-breakpoint

UPDATE academy_students student
SET lead_id = merge.canonical_lead_id
FROM instagram_lead_merge_map merge
WHERE student.lead_id = merge.source_lead_id;
--> statement-breakpoint

-- Move every non-conflicting phone stored on the duplicate before removing its
-- conflicting copies. The unique normalized_phone constraint stays intact.
UPDATE academy_lead_phones phone
SET lead_id = merge.canonical_lead_id,
    updated_at = NOW()
FROM instagram_lead_merge_map merge
WHERE phone.lead_id = merge.source_lead_id
  AND NOT EXISTS (
    SELECT 1
    FROM academy_lead_phones retained_phone
    WHERE retained_phone.lead_id = merge.canonical_lead_id
      AND retained_phone.normalized_phone = phone.normalized_phone
  );
--> statement-breakpoint

DELETE FROM academy_lead_phones phone
USING instagram_lead_merge_map merge
WHERE phone.lead_id = merge.source_lead_id;
--> statement-breakpoint

INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
SELECT
  target.canonical_lead_id,
  target.normalized_phone,
  target.normalized_phone,
  primary_phone.normalized_phone = target.normalized_phone
    AND (retained_lead.phone IS NULL OR retained_lead.phone = '' OR retained_lead.phone LIKE 'instagram:%')
FROM instagram_phone_targets target
JOIN instagram_canonical_phone_updates primary_phone
  ON primary_phone.canonical_lead_id = target.canonical_lead_id
JOIN academy_leads retained_lead ON retained_lead.id = target.canonical_lead_id
ON CONFLICT (normalized_phone) DO NOTHING;
--> statement-breakpoint

UPDATE academy_leads retained_lead
SET phone = primary_phone.normalized_phone,
    updated_at = NOW()
FROM instagram_canonical_phone_updates primary_phone
WHERE retained_lead.id = primary_phone.canonical_lead_id
  AND (retained_lead.phone IS NULL OR retained_lead.phone = '' OR retained_lead.phone LIKE 'instagram:%');
--> statement-breakpoint

INSERT INTO audit_logs (action, entity_type, entity_id, old_values, new_values)
SELECT
  'instagram_phone_extracted',
  'academy_lead',
  target.canonical_lead_id,
  jsonb_build_object('sourceLeadId', target.source_lead_id),
  jsonb_build_object(
    'conversationId', target.conversation_id,
    'messageId', target.message_id,
    'phoneLast4', right(target.normalized_phone, 4)
  )
FROM instagram_phone_targets target;
--> statement-breakpoint

INSERT INTO audit_logs (action, entity_type, entity_id, old_values, new_values)
SELECT
  'instagram_lead_merged',
  'academy_lead',
  merge.canonical_lead_id,
  jsonb_build_object('duplicateLeadId', merge.source_lead_id),
  jsonb_build_object('retainedLeadId', merge.canonical_lead_id, 'reason', 'matching Instagram phone')
FROM instagram_lead_merge_map merge;
--> statement-breakpoint

UPDATE academy_leads duplicate_lead
SET is_archived = true,
    archive_reason = 'duplicate_instagram_lead',
    archived_at = COALESCE(duplicate_lead.archived_at, NOW()),
    updated_at = NOW()
FROM instagram_lead_merge_map merge
WHERE duplicate_lead.id = merge.source_lead_id;
