CREATE TABLE check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES monitored_endpoints(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(4) NOT NULL CHECK (status IN ('UP', 'DOWN')),
  http_status SMALLINT CHECK (http_status BETWEEN 100 AND 599),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  error_type VARCHAR(40)
);

CREATE INDEX check_results_endpoint_checked_at_idx
  ON check_results (endpoint_id, checked_at DESC);

CREATE INDEX check_results_status_checked_at_idx
  ON check_results (status, checked_at DESC);
