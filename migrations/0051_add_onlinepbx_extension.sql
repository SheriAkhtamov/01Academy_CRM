ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "online_pbx_extension" varchar(20);
