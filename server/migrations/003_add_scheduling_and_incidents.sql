ALTER TABLE monitored_endpoints
  ADD COLUMN check_interval_seconds INTEGER NOT NULL DEFAULT 300
    CHECK (check_interval_seconds BETWEEN 30 AND 86400),
  ADD COLUMN next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN check_lease_until TIMESTAMPTZ;

CREATE INDEX monitored_endpoints_due_idx
  ON monitored_endpoints (next_check_at, id)
  WHERE is_active = TRUE;

CREATE INDEX monitored_endpoints_lease_idx
  ON monitored_endpoints (check_lease_until)
  WHERE check_lease_until IS NOT NULL;

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES monitored_endpoints(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);

CREATE UNIQUE INDEX incidents_one_open_per_endpoint_idx
  ON incidents (endpoint_id)
  WHERE resolved_at IS NULL;

CREATE INDEX incidents_endpoint_opened_at_idx
  ON incidents (endpoint_id, opened_at DESC);
