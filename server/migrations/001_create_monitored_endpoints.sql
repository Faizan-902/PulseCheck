CREATE TABLE monitored_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  url TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 100 AND 30000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX monitored_endpoints_created_at_idx
  ON monitored_endpoints (created_at DESC);

CREATE INDEX monitored_endpoints_active_idx
  ON monitored_endpoints (is_active, created_at DESC);
