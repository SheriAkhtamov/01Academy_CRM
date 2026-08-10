DELETE FROM academy_lead_tags tag
WHERE NOT EXISTS (
  SELECT 1
  FROM academy_lead_tag_assignments assignment
  WHERE assignment.tag_id = tag.id
);
