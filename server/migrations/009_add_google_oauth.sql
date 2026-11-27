ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN google_sub TEXT UNIQUE;

CREATE TABLE oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  binding_hash CHAR(64) NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX oauth_states_expires_at_idx ON oauth_states (expires_at);
