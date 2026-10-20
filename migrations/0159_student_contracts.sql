CREATE SEQUENCE IF NOT EXISTS academy_student_contract_number_seq;

CREATE TABLE IF NOT EXISTS academy_student_contracts (
  id uuid PRIMARY KEY,
  student_id integer UNIQUE REFERENCES academy_students(id) ON DELETE CASCADE,
  draft_lead_id integer REFERENCES academy_leads(id) ON DELETE CASCADE,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  number varchar(100) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  file_key varchar(80),
  file_name varchar(255),
  file_mime varchar(100),
  file_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academy_student_contracts_owner_check
    CHECK ((student_id IS NOT NULL) <> (draft_lead_id IS NOT NULL)),
  CONSTRAINT academy_student_contracts_number_check
    CHECK (number = btrim(number) AND length(number) > 0 AND number !~ '[[:cntrl:]]'),
  CONSTRAINT academy_student_contracts_file_check CHECK (
    (file_key IS NULL AND file_name IS NULL AND file_mime IS NULL AND file_size IS NULL)
    OR (file_key IS NOT NULL AND file_name IS NOT NULL AND file_mime IS NOT NULL
      AND file_size IS NOT NULL AND file_size BETWEEN 1 AND 10485760)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_student_contracts_number_unique
  ON academy_student_contracts (lower(number));
CREATE INDEX IF NOT EXISTS academy_student_contracts_draft_owner_idx
  ON academy_student_contracts (created_by, draft_lead_id) WHERE student_id IS NULL;
