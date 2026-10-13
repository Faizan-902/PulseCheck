CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email VARCHAR(320) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token VARCHAR(43) NOT NULL CHECK (length(csrf_token) = 43),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_expires_idx ON user_sessions (user_id, expires_at);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

-- Existing endpoints intentionally remain unowned. They stay available to the
-- monitoring worker but are not visible or accessible through user APIs.
ALTER TABLE monitored_endpoints
  ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX monitored_endpoints_owner_created_idx
  ON monitored_endpoints (owner_id, created_at DESC)
  WHERE owner_id IS NOT NULL;
