ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "telephony_call_id" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'board_tasks_telephony_call_id_telephony_calls_id_fk'
      AND conrelid = 'public.board_tasks'::regclass
  ) THEN
    ALTER TABLE "board_tasks"
      ADD CONSTRAINT "board_tasks_telephony_call_id_telephony_calls_id_fk"
      FOREIGN KEY ("telephony_call_id") REFERENCES "public"."telephony_calls"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_tasks_telephony_call_unique"
  ON "board_tasks" USING btree ("telephony_call_id")
  WHERE "telephony_call_id" IS NOT NULL;
