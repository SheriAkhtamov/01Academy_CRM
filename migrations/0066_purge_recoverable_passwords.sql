-- Passwords must only exist as one-way bcrypt hashes.
UPDATE "users"
SET "credential_password_ciphertext" = NULL
WHERE "credential_password_ciphertext" IS NOT NULL;
