-- Removes the lesson-survey feature.
--
-- Nothing in the product could ever write to it: the only endpoint,
-- POST /api/academy/surveys/lesson, was gated behind staff access and was
-- called from no client code, and the system has no student role or portal.
-- The table therefore held no rows, and every metric derived from it — lesson
-- NPS by teacher and by course, the "low score" risk list, the teacher's
-- average rating tile, the admin lesson-quality tile — reported an empty set.
--
-- academy_students.satisfaction_avg goes with it: the column was a cache of
-- the same survey scores, so it could only ever store its 0 default while
-- being displayed to users as a real average.
--
-- academy_parent_surveys is deliberately left in place. It is a separate
-- feature with its own NPS metric and is not part of this removal.

DROP TABLE IF EXISTS "academy_lesson_surveys";

ALTER TABLE "academy_students"
  DROP COLUMN IF EXISTS "satisfaction_avg";
