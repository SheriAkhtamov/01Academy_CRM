-- Demo lessons and study groups no longer cap how many people can be enrolled.
-- A demo used to inherit the seat count of the booked room (12 by default), so
-- a popular open day could not take a thirteenth guest; groups carried the same
-- ceiling as a CHECK constraint. Both limits are dropped: the demo loses its
-- capacity column outright, and a group keeps only a positive max_students that
-- the branch decides for itself.

ALTER TABLE "academy_demo_lessons"
  DROP CONSTRAINT IF EXISTS "academy_demo_lessons_capacity_check";

ALTER TABLE "academy_demo_lessons"
  DROP COLUMN IF EXISTS "capacity";

ALTER TABLE "academy_groups"
  DROP CONSTRAINT IF EXISTS "academy_groups_capacity_check";

ALTER TABLE "academy_groups"
  ADD CONSTRAINT "academy_groups_capacity_check"
  CHECK ("max_students" >= 1);
