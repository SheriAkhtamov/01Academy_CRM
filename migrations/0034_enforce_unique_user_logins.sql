DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY LOWER(BTRIM(email))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce unique user logins: duplicate emails exist after case normalization';
  END IF;
END
$$;
--> statement-breakpoint
UPDATE users
SET email = LOWER(BTRIM(email)),
    updated_at = NOW()
WHERE email IS DISTINCT FROM LOWER(BTRIM(email));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique"
ON "users" USING btree (LOWER("email"));
