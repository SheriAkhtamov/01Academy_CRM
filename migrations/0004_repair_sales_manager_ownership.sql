WITH manager_load AS (
  SELECT
    u.id,
    COUNT(l.id)::integer AS lead_count,
    AVG(COUNT(l.id)) OVER () AS average_lead_count
  FROM users u
  LEFT JOIN academy_leads l ON l.manager_id = u.id
  WHERE u.role = 'account_manager' AND u.is_active = true
  GROUP BY u.id
),
target_managers AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY lead_count, id) AS manager_index,
    COUNT(*) OVER () AS manager_count
  FROM manager_load
  WHERE lead_count <= average_lead_count
),
invalid_leads AS (
  SELECT
    l.id,
    ROW_NUMBER() OVER (ORDER BY l.created_at, l.id) AS lead_index
  FROM academy_leads l
  LEFT JOIN users u ON u.id = l.manager_id
  WHERE u.id IS NULL
     OR u.role <> 'account_manager'
     OR u.is_active = false
),
assignments AS (
  SELECT
    invalid_leads.id AS lead_id,
    target_managers.id AS manager_id
  FROM invalid_leads
  JOIN target_managers
    ON target_managers.manager_index =
       ((invalid_leads.lead_index - 1) % target_managers.manager_count) + 1
)
UPDATE academy_leads AS leads
SET manager_id = assignments.manager_id,
    updated_at = NOW()
FROM assignments
WHERE leads.id = assignments.lead_id;
--> statement-breakpoint
UPDATE academy_students AS students
SET manager_id = leads.manager_id,
    updated_at = NOW()
FROM academy_leads AS leads
WHERE students.lead_id = leads.id
  AND students.manager_id IS DISTINCT FROM leads.manager_id;
--> statement-breakpoint
UPDATE academy_tasks AS tasks
SET responsible_id = leads.manager_id,
    updated_at = NOW()
FROM academy_leads AS leads
WHERE tasks.entity_type = 'lead'
  AND tasks.entity_id = leads.id
  AND tasks.responsible_id IS DISTINCT FROM leads.manager_id;
--> statement-breakpoint
UPDATE academy_tasks AS tasks
SET responsible_id = students.manager_id,
    updated_at = NOW()
FROM academy_students AS students
WHERE tasks.entity_type = 'student'
  AND tasks.entity_id = students.id
  AND tasks.responsible_id IS DISTINCT FROM students.manager_id;
