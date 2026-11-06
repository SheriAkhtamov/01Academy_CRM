-- Platform overhaul, stage 3 (contract). The release with 0174 is live: it
-- treats an online group as roomless and keeps the teacher's lesson note on
-- the lesson, so what 0174 left in place for a rollback goes now.

-- A group that was online before 0174 kept its room. Its lessons still to
-- come leave the room as well; conducted lessons keep the room they had.
UPDATE "academy_lessons" lesson SET "room_id" = NULL
FROM "academy_groups" academy_group
WHERE academy_group.id = lesson.group_id
  AND academy_group.delivery_mode = 'online'
  AND lesson.status = 'scheduled'
  AND lesson.room_id IS NOT NULL;
--> statement-breakpoint
UPDATE "academy_groups" SET "room_id" = NULL WHERE "delivery_mode" = 'online' AND "room_id" IS NOT NULL;
--> statement-breakpoint
-- An online group never holds a room, so it never blocks one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_groups_online_without_room'
      AND conrelid = 'public.academy_groups'::regclass) THEN
    ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_online_without_room"
      CHECK ("delivery_mode" <> 'online' OR "room_id" IS NULL);
  END IF;
END $$;
--> statement-breakpoint
-- Before 0174 the lesson note was copied onto every pupil's mark. A copy equal
-- to the lesson's own note is not a note about the pupil.
UPDATE "academy_attendance" mark SET "note" = NULL
FROM "academy_lessons" lesson
WHERE lesson.id = mark.lesson_id
  AND lesson.note IS NOT NULL
  AND btrim(mark.note) = btrim(lesson.note);
