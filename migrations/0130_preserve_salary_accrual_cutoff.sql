-- Keep the employee's final calendar day after users FK references are cleared.
-- Legacy deleted employees have no reliable deletion day; preserve their
-- existing history rather than inventing a cutoff from salary creation dates.
ALTER TABLE "academy_salary_rates"
  ADD COLUMN IF NOT EXISTS "employment_ended_on" date;
