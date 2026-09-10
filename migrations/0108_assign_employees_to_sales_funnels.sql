CREATE TABLE academy_sales_funnel_users (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funnel_id integer NOT NULL REFERENCES academy_sales_funnels(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, funnel_id)
);
CREATE INDEX academy_sales_funnel_users_funnel_idx
  ON academy_sales_funnel_users(funnel_id);
--> statement-breakpoint
-- Existing employees keep the same queues they could access before explicit
-- funnel selection was introduced. Custom funnels remain available to both
-- roles; protected workflow funnels keep their hunter/closer boundary.
INSERT INTO academy_sales_funnel_users(user_id, funnel_id)
SELECT employee.id, funnel.id
FROM users employee
CROSS JOIN academy_sales_funnels funnel
WHERE funnel.is_active = true
  AND (
    employee.module = 'sales'
    OR EXISTS (
      SELECT 1 FROM user_modules access
      WHERE access.user_id = employee.id AND access.module = 'sales'
    )
  )
  AND (
    funnel.workflow_role IS NULL
    OR funnel.workflow_role = CASE
      WHEN academy_kpi_employee_role(employee.id) = 'closer' THEN 'closer'
      ELSE 'hunter'
    END
    OR EXISTS (
      SELECT 1 FROM academy_leads lead
      WHERE lead.manager_id = employee.id AND lead.funnel_id = funnel.id
    )
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION protect_sales_funnel_user_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM academy_sales_funnel_users assignment
    WHERE assignment.user_id = NEW.manager_id
      AND assignment.funnel_id = NEW.funnel_id
  ) THEN
    RAISE EXCEPTION 'salesFunnelNotAssigned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_sales_funnel_user_assignment
  BEFORE INSERT OR UPDATE OF manager_id, funnel_id ON academy_leads
  FOR EACH ROW EXECUTE FUNCTION protect_sales_funnel_user_assignment();
