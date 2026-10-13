CREATE TABLE login_rate_limits (
  key_hash CHAR(64) PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits >= 0),
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX login_rate_limits_reset_at_idx ON login_rate_limits (reset_at);
