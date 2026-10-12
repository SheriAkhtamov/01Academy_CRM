CREATE TABLE platform_updates (
  id serial PRIMARY KEY,
  publication_key varchar(100) NOT NULL UNIQUE,
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_updates_published_idx ON platform_updates(published_at DESC, id DESC);
