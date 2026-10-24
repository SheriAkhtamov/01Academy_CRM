CREATE TABLE onlinepbx_license_issues (
  id serial PRIMARY KEY,
  domain varchar(255) NOT NULL,
  extension varchar(20) NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id integer REFERENCES board_tasks(id) ON DELETE SET NULL,
  opened_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  resolved_at timestamp,
  CONSTRAINT onlinepbx_license_issues_extension_unique UNIQUE (domain, extension, user_id)
);
