CREATE OR REPLACE FUNCTION academy_next_auto_lead_manager(p_funnel_id integer)
RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  settings_row academy_company_settings%ROWTYPE;
  manager_ids integer[];
  manager_count integer;
  selected_manager integer;
BEGIN
  SELECT * INTO settings_row
  FROM academy_company_settings
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR settings_row.auto_lead_distribution_enabled IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM academy_sales_funnels funnel
    WHERE funnel.id = p_funnel_id
      AND funnel.is_active = true
      AND funnel.is_default = true
      AND funnel.workflow_role = 'hunter'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(employee.id ORDER BY employee.id)
  INTO manager_ids
  FROM academy_sales_funnel_users assignment
  JOIN users employee ON employee.id = assignment.user_id
  WHERE assignment.funnel_id = p_funnel_id
    AND employee.is_active = true
    AND employee.is_archived = false
    AND (
      employee.module = 'sales'
      OR EXISTS (
        SELECT 1 FROM user_modules access
        WHERE access.user_id = employee.id AND access.module = 'sales'
      )
    )
    AND academy_kpi_employee_role(employee.id) IN ('hunter', 'full_cycle', 'full_cycle_3500');

  manager_count := COALESCE(array_length(manager_ids, 1), 0);
  IF manager_count = 0 THEN RETURN NULL; END IF;

  selected_manager := manager_ids[((settings_row.auto_lead_distribution_cursor % manager_count) + 1)::integer];
  UPDATE academy_company_settings
  SET auto_lead_distribution_cursor = auto_lead_distribution_cursor + 1,
      updated_at = timezone('UTC', now())
  WHERE id = settings_row.id;

  RETURN selected_manager;
END $$;
