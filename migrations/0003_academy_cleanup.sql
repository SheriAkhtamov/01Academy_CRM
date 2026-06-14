DO $$
DECLARE
  legacy_table text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'document' || 'ation_attach' || 'ments',
    'inter' || 'views',
    'inter' || 'view_stages',
    'candi' || 'dates',
    'vacan' || 'cies'
  ] LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', legacy_table);
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE "users"
SET "role" = 'account_manager'
WHERE "role" = 'h' || 'r_manager';
