CREATE TABLE telephony_manager_line_priorities (
  extension varchar(20) PRIMARY KEY,
  requester_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  blocking_client_call_id varchar(160) NOT NULL,
  -- This identity must survive lease cleanup and application restarts.
  blocking_reservation_id uuid,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  priority_until timestamptz,
  CHECK ((ended_at IS NULL AND priority_until IS NULL)
    OR (ended_at IS NOT NULL AND priority_until IS NOT NULL AND priority_until=ended_at+interval '3 minutes'))
);
