-- Run only on a restored staging database, before application or import checks.
-- The caller must SET lms_staging.confirm_redaction='yes' in this session.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'lms_staging' OR current_setting('lms_staging.confirm_redaction',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Redaction is restricted to an explicitly confirmed lms_staging database';
  END IF;
END $$;
CREATE TEMP TABLE stage_trigger_state ON COMMIT DROP AS
  SELECT relation.relname AS table_name,trigger.tgname AS trigger_name,trigger.tgenabled AS enabled
  FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public' AND NOT trigger.tgisinternal;
DO $$ DECLARE relation record; BEGIN
  PERFORM set_config('lms_staging.redaction_salt',gen_random_uuid()::text,true);
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER',relation.tablename);
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.stage_contact(value text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN value IS NULL THEN NULL ELSE '998'||translate(substr(md5(current_setting('lms_staging.redaction_salt')||regexp_replace(value,'[^0-9]','','g')),1,12),'abcdef','012345') END
$$;
CREATE FUNCTION pg_temp.stage_json(value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN SELECT COALESCE(jsonb_object_agg(key,pg_temp.stage_json(entry)),'{}'::jsonb) INTO result FROM jsonb_each(value) AS item(key,entry);
    WHEN 'array' THEN SELECT COALESCE(jsonb_agg(pg_temp.stage_json(entry) ORDER BY ord),'[]'::jsonb) INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS item(entry,ord);
    WHEN 'string' THEN result:=to_jsonb('Staging content'::text);
    ELSE result:=value;
  END CASE;
  RETURN result;
END $$;
DO $$
DECLARE column_record record;
BEGIN
  FOR column_record IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND column_name=ANY(ARRAY['phone','normalized_phone','verified_phone','online_pbx_forwarding_phone'])
  LOOP EXECUTE format('UPDATE %I SET %I=pg_temp.stage_contact(%I)',column_record.table_name,column_record.column_name,column_record.column_name); END LOOP;
  FOR column_record IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND column_name=ANY(ARRAY['full_name','employee_name','sender_name','creator_name','contact_name','student_name','participant_name','display_name','participant_username','handle','original_name','label','vendor','position','address','locality']) AND data_type IN ('text','character varying')
  LOOP EXECUTE format('UPDATE %I SET %I=CASE WHEN %I IS NULL THEN NULL ELSE %L||substr(md5(current_setting(''lms_staging.redaction_salt'')||%I),1,12) END',column_record.table_name,column_record.column_name,column_record.column_name,'Staging ',column_record.column_name); END LOOP;
  FOR column_record IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND column_name=ANY(ARRAY['comment','note','notes','body','content','message','description','reason','cancellation_reason','no_show_reason_note','not_conducted_reason_note','last_reschedule_reason','parent_feedback','warm_reason','goal','urgency','refund_comment','first_contact_result','demo_result','error_message','approval_comment','archive_reason','exit_reason','from_value','to_value'])
    AND data_type IN ('text','character varying')
  LOOP EXECUTE format('UPDATE %I SET %I=CASE WHEN %I IS NULL THEN NULL ELSE %L END',column_record.table_name,column_record.column_name,column_record.column_name,'Staging content'); END LOOP;
  FOR column_record IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND column_name=ANY(ARRAY['payload','metadata','raw_payload','user_data','custom_data','response_payload','old_values','new_values','meta','utm_values','attachments','risk_flags']) AND data_type='jsonb'
  LOOP EXECUTE format('UPDATE %I SET %I=pg_temp.stage_json(%I)',column_record.table_name,column_record.column_name,column_record.column_name); END LOOP;
END $$;
UPDATE users SET email='staff-'||id||'@example.invalid',password='disabled-staging-account',credential_password_ciphertext=NULL,date_of_birth=NULL,online_pbx_extension=NULL,online_pbx_incoming_enabled=false,avatar_url=NULL;
UPDATE academy_leads SET messenger=NULL;
UPDATE academy_students SET messenger=NULL;
UPDATE academy_courses SET program=pg_temp.stage_json(program);
UPDATE academy_lessons SET topic='Staging lesson '||id,
  materials=(SELECT string_agg(reference[1],E'\n') FROM regexp_matches(COALESCE(materials,''),'(/uploads/[^\s<>"'']+)','g') AS reference);
UPDATE academy_portfolio_projects SET title='Staging project '||id,url=CASE WHEN url LIKE '/uploads/%' THEN url ELSE NULL END;
UPDATE academy_lead_channels SET external_id=CASE WHEN external_id IS NULL THEN NULL ELSE 'stage-'||id END,profile_url=NULL,provider_account_id='staging';
DELETE FROM academy_integration_settings;
UPDATE instagram_accounts SET access_token_encrypted='disabled-staging-token',profile_picture_url=NULL;
UPDATE instagram_conversations SET participant_profile_picture_url=NULL;
UPDATE telephony_calls SET recording_url=NULL,contact_name='Staging contact';
TRUNCATE session,saved_accounts;
DO $$ DECLARE previous record; BEGIN
  FOR previous IN SELECT * FROM stage_trigger_state LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I',previous.table_name,
      CASE previous.enabled WHEN 'O' THEN 'ENABLE' WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'DISABLE' END,previous.trigger_name);
  END LOOP;
END $$;
COMMIT;
