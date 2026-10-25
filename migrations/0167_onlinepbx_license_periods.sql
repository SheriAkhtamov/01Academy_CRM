CREATE TABLE onlinepbx_license_periods (
  domain varchar(255) NOT NULL,
  service_type varchar(64) NOT NULL,
  start_stamp bigint NOT NULL,
  end_stamp bigint NOT NULL,
  service_count integer NOT NULL CHECK (service_count > 0),
  is_current boolean NOT NULL,
  first_seen_at timestamp NOT NULL,
  last_seen_at timestamp NOT NULL,
  PRIMARY KEY (domain, service_type, start_stamp, end_stamp),
  CHECK (end_stamp >= start_stamp)
);
ALTER TABLE onlinepbx_license_tasks ADD COLUMN coverage jsonb;
