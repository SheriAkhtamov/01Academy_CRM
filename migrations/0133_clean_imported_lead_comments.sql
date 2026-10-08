-- Remove the former import template from customer-facing comments. Attribution,
-- original import payloads, authors and timestamps remain in their own records.
CREATE FUNCTION academy_clean_import_comment(content text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
 line text;
 lines text[] := ARRAY[]::text[];
 in_import boolean := false;
 in_metadata boolean := false;
 in_consent boolean := false;
BEGIN
 IF content IS NULL OR content !~ E'(^|\n)\\[Импорт .+ · .+ · #[^]]+\\]' THEN RETURN content; END IF;
 FOREACH line IN ARRAY regexp_split_to_array(content, E'\n') LOOP
   line := rtrim(line, E'\r');
   IF line ~ '^\[Импорт .+ · .+ · #[^]]+\]$' THEN
     in_import := true; in_metadata := true; in_consent := false;
     CONTINUE;
   END IF;
   IF in_import AND in_metadata AND line ~ '^(Дата заявки|Кампания|ID кампании|Группа объявлений|ID группы объявлений|Объявление|ID объявления|Форма|ID формы|Платформа|Органическая заявка):' THEN
     CONTINUE;
   END IF;
   IF in_import AND line = 'Ответы формы:' THEN
     in_metadata := false;
     CONTINUE;
   END IF;
   IF in_import AND line = 'Согласия формы:' THEN
     in_metadata := false; in_consent := true;
     CONTINUE;
   END IF;
   IF in_consent AND line ~ '^• ' THEN CONTINUE; END IF;
   IF in_import AND line ~ '^• (external id|leadgen id|page id|campaign (id|name)|adset (id|name)|ad (id|name)|form (id|name)|created time|platform|is organic|source sheet|row|sheet):' THEN CONTINUE; END IF;
   IF in_import THEN
     line := regexp_replace(line, '^• (full name|contact name|parent name|first name):', '• Имя:', 'i');
     line := regexp_replace(line, '^• last name:', '• Фамилия:', 'i');
     line := regexp_replace(line, '^• (phone|phone number|mobile phone|mobile number):', '• Телефон:', 'i');
     line := regexp_replace(line, '^• email:', '• Электронная почта:', 'i');
   END IF;
   -- The generated metadata is a contiguous prefix. Following notes and form
   -- answers may contain the same words, so they are never filtered as metadata.
   in_metadata := false;
   IF line = '' OR (in_consent AND line !~ '^• ') THEN
     in_import := false; in_consent := false;
   END IF;
   lines := array_append(lines, line);
 END LOOP;
 RETURN btrim(array_to_string(lines, E'\n'), E'\n\r ');
END $$;
--> statement-breakpoint
DELETE FROM academy_lead_comments
WHERE body IS DISTINCT FROM academy_clean_import_comment(body)
 AND academy_clean_import_comment(body) = '';
UPDATE academy_lead_comments
SET body = academy_clean_import_comment(body)
WHERE body IS DISTINCT FROM academy_clean_import_comment(body);
--> statement-breakpoint
-- A comment-only cleanup must not touch frozen KPI facts or generate activity.
ALTER TABLE academy_leads DISABLE TRIGGER academy_kpi_lead_capture;
UPDATE academy_leads
SET comment = NULLIF(academy_clean_import_comment(comment), ''),
    updated_at = timezone('UTC', now())
WHERE comment IS DISTINCT FROM academy_clean_import_comment(comment);
ALTER TABLE academy_leads ENABLE TRIGGER academy_kpi_lead_capture;
--> statement-breakpoint
UPDATE academy_lead_stage_history SET comment = NULL
WHERE from_status_code IS NULL AND comment ~ '^Импортирован из Meta[^\n]*$';
DROP FUNCTION academy_clean_import_comment(text);
