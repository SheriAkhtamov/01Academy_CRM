LOCK TABLE
  academy_rooms,
  academy_groups,
  academy_lessons,
  academy_demo_lessons
IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  source_room_id integer;
  source_school_id integer;
  source_room_count integer;
  target_room_id integer;
  target_room_count integer;
BEGIN
  SELECT COUNT(*), MIN(id), MIN(school_id)
  INTO source_room_count, source_room_id, source_school_id
  FROM academy_rooms
  WHERE BTRIM(name) = 'Лагерь 2 смена';

  -- Data-only migrations must remain safe in installations that never had this
  -- production room. A partially matching setup, however, is ambiguous and must
  -- stop instead of guessing which records to move.
  IF source_room_count = 0 THEN
    RETURN;
  END IF;

  IF source_room_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one source room named "Лагерь 2 смена", found %',
      source_room_count;
  END IF;

  SELECT COUNT(*), MIN(id)
  INTO target_room_count, target_room_id
  FROM academy_rooms
  WHERE school_id = source_school_id
    AND BTRIM(name) = '117';

  IF target_room_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one target room named "117" in school %, found %',
      source_school_id,
      target_room_count;
  END IF;

  UPDATE academy_groups
  SET room_id = target_room_id
  WHERE room_id = source_room_id;

  UPDATE academy_lessons
  SET room_id = target_room_id
  WHERE room_id = source_room_id;

  UPDATE academy_demo_lessons
  SET room_id = target_room_id
  WHERE room_id = source_room_id;

  IF EXISTS (
    SELECT 1 FROM academy_groups WHERE room_id = source_room_id
    UNION ALL
    SELECT 1 FROM academy_lessons WHERE room_id = source_room_id
    UNION ALL
    SELECT 1 FROM academy_demo_lessons WHERE room_id = source_room_id
  ) THEN
    RAISE EXCEPTION
      'Room % still has dependent records after reassignment',
      source_room_id;
  END IF;

  DELETE FROM academy_rooms
  WHERE id = source_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source room % was not deleted', source_room_id;
  END IF;
END
$$;
