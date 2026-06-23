CREATE TABLE "academy_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"capacity" integer DEFAULT 12 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "academy_rooms_capacity_check" CHECK ("academy_rooms"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "academy_rooms" ADD CONSTRAINT "academy_rooms_school_id_academy_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_rooms_school_idx" ON "academy_rooms" USING btree ("school_id");
--> statement-breakpoint
CREATE INDEX "academy_rooms_active_idx" ON "academy_rooms" USING btree ("school_id", "is_active");
--> statement-breakpoint

-- Preserve the rooms already stored in academy_schools.rooms before changing
-- the scheduling model. Empty schools receive a fallback room, making room_id
-- safe to mark NOT NULL for existing groups and lessons.
INSERT INTO "academy_rooms" ("school_id", "name", "capacity", "is_active")
SELECT school.id, BTRIM(legacy_room.name), 12, true
FROM "academy_schools" AS school
CROSS JOIN LATERAL jsonb_array_elements_text(
	CASE WHEN jsonb_typeof(school.rooms) = 'array' THEN school.rooms ELSE '[]'::jsonb END
) AS legacy_room(name)
WHERE NULLIF(BTRIM(legacy_room.name), '') IS NOT NULL;
--> statement-breakpoint
INSERT INTO "academy_rooms" ("school_id", "name", "capacity", "is_active")
SELECT school.id, 'Основной кабинет', 12, true
FROM "academy_schools" AS school
WHERE NOT EXISTS (
	SELECT 1 FROM "academy_rooms" room WHERE room.school_id = school.id
);
--> statement-breakpoint

ALTER TABLE "academy_groups" ADD COLUMN "room_id" integer;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD COLUMN "room_id" integer;
--> statement-breakpoint
UPDATE "academy_groups" group_row
SET "room_id" = (
	SELECT room.id FROM "academy_rooms" room
	WHERE room.school_id = group_row.school_id AND room.is_active = true
	ORDER BY room.id
	LIMIT 1
)
WHERE group_row.room_id IS NULL;
--> statement-breakpoint
UPDATE "academy_lessons" lesson
SET "school_id" = group_row.school_id
FROM "academy_groups" group_row
WHERE lesson.group_id = group_row.id AND lesson.school_id IS NULL;
--> statement-breakpoint
UPDATE "academy_lessons" lesson
SET "room_id" = COALESCE(
	group_row.room_id,
	(
		SELECT room.id FROM "academy_rooms" room
		WHERE room.school_id = COALESCE(lesson.school_id, group_row.school_id)
		  AND room.is_active = true
		ORDER BY room.id
		LIMIT 1
	)
)
FROM "academy_groups" group_row
WHERE lesson.group_id = group_row.id AND lesson.room_id IS NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ALTER COLUMN "room_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ALTER COLUMN "room_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_room_id_academy_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."academy_rooms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_room_id_academy_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."academy_rooms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_groups_room_idx" ON "academy_groups" USING btree ("room_id");
--> statement-breakpoint
CREATE INDEX "academy_lessons_room_idx" ON "academy_lessons" USING btree ("room_id");
