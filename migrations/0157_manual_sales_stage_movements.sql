-- Moving an existing lead never assigns it automatically. Distribution remains
-- an intake behavior for newly created leads and the explicit admin action.
DROP TRIGGER IF EXISTS academy_auto_distribute_lead ON academy_leads;

CREATE OR REPLACE FUNCTION academy_auto_distribute_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_manager integer;
BEGIN
 IF NEW.manager_id IS NULL AND COALESCE(NEW.is_archived, false) = false
   AND EXISTS(SELECT 1 FROM academy_sales_funnels WHERE id = NEW.funnel_id AND initial_stage_code = NEW.status_code) THEN
   selected_manager := academy_next_auto_lead_manager(NEW.funnel_id);
   IF selected_manager IS NOT NULL THEN NEW.manager_id := selected_manager;
     NEW.first_viewed_at := NULL; NEW.first_viewed_by := NULL; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER academy_auto_distribute_lead BEFORE INSERT
 ON academy_leads FOR EACH ROW EXECUTE FUNCTION academy_auto_distribute_lead();
