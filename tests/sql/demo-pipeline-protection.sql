-- Current-schema check: apply all registered migrations first. Test data rolls back.
-- psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f tests/sql/demo-pipeline-protection.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  funnel_key integer; first_code text := 'verify_intake_' || txid_current();
  ordinary_code text := 'verify_ordinary_' || txid_current(); mutation text; rejected boolean;
  legacy_stage record;
BEGIN
  IF current_database() NOT LIKE '%\_test' ESCAPE '\' AND current_database() NOT LIKE 'crm_demo_workflow_test_%' THEN
    RAISE EXCEPTION 'Use a disposable workflow test database';
  END IF;
  ASSERT to_regclass('academy_lead_funnel_qualifications') IS NOT NULL, 'Apply migration 0128 first';
  ASSERT to_regprocedure('academy_transition_demo_lead(integer,text,boolean,integer,integer,text)') IS NULL,
    'Legacy automatic demo transition must be removed';
  ASSERT to_regprocedure('academy_sales_stage_role(text)') IS NULL, 'Stages must not determine workforce roles';
  ASSERT to_regprocedure('protect_demo_pipeline_statuses()') IS NULL, 'Legacy demo labels must not remain protected';

  INSERT INTO academy_sales_funnels(name) VALUES ('Pipeline verification ' || txid_current()) RETURNING id INTO funnel_key;
  INSERT INTO academy_lead_statuses(code, name, color, sort_order, funnel_id, is_pipeline)
    VALUES(first_code, 'Intake', '#112233', 0, funnel_key, true),
          (ordinary_code, 'Ordinary', '#445566', 10, funnel_key, true);
  UPDATE academy_sales_funnels SET initial_stage_code = first_code WHERE id = funnel_key;
  UPDATE academy_lead_statuses SET name = 'Renamed intake', color = '#ffffff' WHERE code = first_code;
  ASSERT (SELECT initial_stage_code = first_code FROM academy_sales_funnels WHERE id = funnel_key),
    'Renaming the initial label must keep intake metadata';

  FOREACH mutation IN ARRAY ARRAY[
    'DELETE FROM academy_lead_statuses WHERE code = $1',
    'UPDATE academy_lead_statuses SET is_active = false WHERE code = $1',
    'UPDATE academy_lead_statuses SET is_pipeline = false WHERE code = $1',
    'UPDATE academy_lead_statuses SET sort_order = 10 WHERE code = $1',
    'UPDATE academy_lead_statuses SET code = code || ''_renamed'' WHERE code = $1'
  ] LOOP
    rejected := false;
    BEGIN EXECUTE mutation USING first_code;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('pipelineInitialStageProtected', 'pipelineInitialStageCannotBeDeleted') THEN RAISE; END IF;
      rejected := true;
    END;
    ASSERT rejected, 'The explicitly configured first stage must remain available';
  END LOOP;

  UPDATE academy_lead_statuses SET name = 'Renamed', color = '#abcdef', sort_order = 30,
    is_pipeline = false, is_active = false WHERE code = ordinary_code;
  DELETE FROM academy_lead_statuses WHERE code = ordinary_code;
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_statuses WHERE code = ordinary_code), 'Ordinary stage deletion';

  -- Old built-in labels have exactly the same mutability as other ordinary labels.
  FOR legacy_stage IN SELECT status.code FROM academy_lead_statuses status
    WHERE status.code IN ('demo_attended', 'ne_prishli_na_vstrechu', 'paid', 'enrolled', 'qualified', 'not_now')
      AND NOT EXISTS(SELECT 1 FROM academy_sales_funnels WHERE initial_stage_code = status.code)
  LOOP
    UPDATE academy_lead_statuses SET name = 'Changed legacy label', is_active = false, is_pipeline = false WHERE code = legacy_stage.code;
    DELETE FROM academy_lead_statuses WHERE code = legacy_stage.code;
  END LOOP;
  ASSERT NOT EXISTS(SELECT 1 FROM academy_sales_funnels funnel
    LEFT JOIN academy_lead_statuses stage ON stage.code = funnel.initial_stage_code
    WHERE stage.id IS NULL OR stage.funnel_id <> funnel.id OR NOT stage.is_active OR NOT stage.is_pipeline OR stage.sort_order <> 0),
    'Every funnel must keep its explicit active first stage';
  RAISE NOTICE 'PASS: intake metadata stays stable; only initial stages are protected; ordinary legacy labels are editable and deletable';
END $$;
ROLLBACK;
