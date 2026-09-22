CREATE TABLE "academy_integration_settings" (
  "provider" text PRIMARY KEY,
  "encrypted_config" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
