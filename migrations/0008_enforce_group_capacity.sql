UPDATE "academy_groups"
SET "max_students" = LEAST(GREATEST("max_students", 1), 12);
--> statement-breakpoint
UPDATE "academy_schools"
SET "rooms" = CASE
  WHEN jsonb_array_length("rooms") > 0 THEN jsonb_build_array("rooms"->0)
  ELSE '[]'::jsonb
END;
--> statement-breakpoint
UPDATE "academy_groups"
SET "school_id" = (SELECT "id" FROM "academy_schools" ORDER BY "id" LIMIT 1)
WHERE "school_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups"
DROP CONSTRAINT IF EXISTS "academy_groups_school_id_academy_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "academy_groups"
ALTER COLUMN "school_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups"
ADD CONSTRAINT "academy_groups_school_id_academy_schools_id_fk"
FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_groups"
ADD CONSTRAINT "academy_groups_capacity_check"
CHECK ("max_students" BETWEEN 1 AND 12);
