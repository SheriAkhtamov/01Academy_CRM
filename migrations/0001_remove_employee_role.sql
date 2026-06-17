UPDATE "users"
SET
  "role" = 'account_manager',
  "is_active" = false,
  "updated_at" = NOW()
WHERE "role" = 'employee';
