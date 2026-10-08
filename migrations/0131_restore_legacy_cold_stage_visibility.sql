-- The former cold label is now an ordinary stage. Migration 0007 had hidden
-- it from the pipeline, and 0128 preserved that historical flag when cloning
-- shared labels. Preserve activation, labels and all lead/history records.
WITH legacy AS (
 SELECT id, name, color, is_active, created_at FROM academy_lead_statuses WHERE code = 'not_now'
), conversion_times AS (
 -- The configured intake points to the exact clone selected by 0128, even
 -- when a custom stage occupied its unsuffixed code before conversion.
 SELECT DISTINCT intake.created_at
 FROM academy_sales_funnels funnel
 JOIN academy_lead_statuses intake ON intake.code = funnel.initial_stage_code AND intake.funnel_id = funnel.id
 JOIN academy_lead_statuses source ON source.code IN ('new_request', 'demo_attended')
 WHERE intake.code ~ ('^' || source.code || '_f' || funnel.id || '_s' || source.id || '(_copy[1-9][0-9]*)?$')
   AND intake.id > source.id AND intake.created_at > source.created_at
), converted_labels AS (
 SELECT id FROM legacy
 UNION ALL
 SELECT candidate.id FROM academy_lead_statuses candidate CROSS JOIN legacy
 WHERE candidate.code ~ ('^not_now_f' || candidate.funnel_id || '_s' || legacy.id || '(_copy[1-9][0-9]*)?$')
   AND candidate.id > legacy.id AND candidate.created_at > legacy.created_at
   AND candidate.created_at IN (SELECT created_at FROM conversion_times)
   AND candidate.name = legacy.name AND candidate.color = legacy.color
   AND candidate.is_active = legacy.is_active
)
-- If no original intake clone survives, repair only the source label; a code
-- pattern alone cannot prove that a remaining candidate came from conversion.
UPDATE academy_lead_statuses stage SET is_pipeline = true
FROM converted_labels converted WHERE stage.id = converted.id AND stage.is_pipeline = false;
