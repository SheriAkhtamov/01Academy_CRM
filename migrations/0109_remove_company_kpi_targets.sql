ALTER TABLE academy_company_settings
  DROP COLUMN IF EXISTS target_revenue_monthly_uzs,
  DROP COLUMN IF EXISTS target_new_leads_monthly,
  DROP COLUMN IF EXISTS max_cac_uzs,
  DROP COLUMN IF EXISTS max_cpl_uzs,
  DROP COLUMN IF EXISTS target_roas,
  DROP COLUMN IF EXISTS target_attendance_percent,
  DROP COLUMN IF EXISTS target_nps;
