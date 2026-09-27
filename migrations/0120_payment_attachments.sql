CREATE TABLE academy_payment_attachments (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL REFERENCES academy_payments(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size integer NOT NULL,
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT academy_payment_attachments_size_check CHECK (size > 0 AND size <= 10485760)
);
--> statement-breakpoint
CREATE INDEX academy_payment_attachments_payment_idx ON academy_payment_attachments(payment_id);
--> statement-breakpoint
CREATE UNIQUE INDEX academy_payment_attachments_file_name_unique ON academy_payment_attachments(file_name);
