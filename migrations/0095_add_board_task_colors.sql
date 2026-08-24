-- Task colours are stored as controlled palette codes so user input cannot
-- become arbitrary CSS and every colour remains readable in both themes.

ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "color" varchar(20);

DO $$ BEGIN
  ALTER TABLE "board_tasks"
    ADD CONSTRAINT "board_tasks_color_check"
    CHECK (
      "color" IS NULL
      OR "color" IN ('blue', 'emerald', 'amber', 'violet', 'rose', 'cyan')
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
