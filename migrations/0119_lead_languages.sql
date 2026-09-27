ALTER TABLE academy_leads ADD COLUMN languages text[];
--> statement-breakpoint
UPDATE academy_leads SET languages = ARRAY[language] WHERE languages IS NULL;
