CREATE OR REPLACE FUNCTION public.academy_clean_lead_tag_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        normalize(value, NFKC),
        U&'\00AD\034F\061C\180E\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2061\2062\2063\2064\2066\2067\2068\2069\206A\206B\206C\206D\206E\206F\FEFF',
        ''
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.academy_normalize_lead_tag_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(public.academy_clean_lead_tag_name(value))
$$;
--> statement-breakpoint
LOCK TABLE academy_lead_tags, academy_lead_tag_assignments
  IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TEMPORARY TABLE academy_lead_tag_merge_map ON COMMIT DROP AS
SELECT
  id AS tag_id,
  MIN(id) OVER (
    PARTITION BY public.academy_normalize_lead_tag_name(name)
  ) AS survivor_tag_id,
  public.academy_normalize_lead_tag_name(name) AS canonical_name
FROM academy_lead_tags;
--> statement-breakpoint
DELETE FROM academy_lead_tags tag
USING academy_lead_tag_merge_map merge_map
WHERE tag.id = merge_map.tag_id
  AND merge_map.canonical_name = '';
--> statement-breakpoint
INSERT INTO academy_lead_tag_assignments
  (lead_id, tag_id, created_by, created_at)
SELECT DISTINCT ON (assignment.lead_id, merge_map.survivor_tag_id)
  assignment.lead_id,
  merge_map.survivor_tag_id,
  assignment.created_by,
  assignment.created_at
FROM academy_lead_tag_assignments assignment
JOIN academy_lead_tag_merge_map merge_map
  ON merge_map.tag_id = assignment.tag_id
WHERE merge_map.tag_id <> merge_map.survivor_tag_id
  AND merge_map.canonical_name <> ''
ORDER BY
  assignment.lead_id,
  merge_map.survivor_tag_id,
  assignment.created_at,
  assignment.id
ON CONFLICT (lead_id, tag_id) DO NOTHING;
--> statement-breakpoint
DELETE FROM academy_lead_tag_assignments assignment
USING academy_lead_tag_merge_map merge_map
WHERE assignment.tag_id = merge_map.tag_id
  AND merge_map.tag_id <> merge_map.survivor_tag_id
  AND merge_map.canonical_name <> '';
--> statement-breakpoint
DELETE FROM academy_lead_tags tag
USING academy_lead_tag_merge_map merge_map
WHERE tag.id = merge_map.tag_id
  AND merge_map.tag_id <> merge_map.survivor_tag_id
  AND merge_map.canonical_name <> '';
--> statement-breakpoint
UPDATE academy_lead_tags tag
SET
  name = public.academy_clean_lead_tag_name(tag.name),
  normalized_name = public.academy_normalize_lead_tag_name(tag.name),
  updated_at = NOW()
WHERE tag.name IS DISTINCT FROM public.academy_clean_lead_tag_name(tag.name)
   OR tag.normalized_name IS DISTINCT FROM public.academy_normalize_lead_tag_name(tag.name);
--> statement-breakpoint
DELETE FROM academy_lead_tag_assignments assignment
USING academy_leads lead, academy_lead_sources source, academy_lead_tags tag
WHERE assignment.lead_id = lead.id
  AND lead.source_id = source.id
  AND assignment.tag_id = tag.id
  AND source.is_active = true
  AND tag.normalized_name = public.academy_normalize_lead_tag_name(source.name);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'academy_lead_tags_canonical_name'
      AND conrelid = 'academy_lead_tags'::regclass
  ) THEN
    ALTER TABLE academy_lead_tags
      ADD CONSTRAINT academy_lead_tags_canonical_name
      CHECK (
        CHAR_LENGTH(name) <= 48
        AND name !~ '[[:cntrl:]]'
        AND name = public.academy_clean_lead_tag_name(name)
        AND normalized_name = public.academy_normalize_lead_tag_name(name)
      ) NOT VALID;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE academy_lead_tags
  VALIDATE CONSTRAINT academy_lead_tags_canonical_name;
