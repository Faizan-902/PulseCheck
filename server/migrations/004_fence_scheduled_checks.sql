ALTER TABLE monitored_endpoints
  ADD COLUMN check_lease_token UUID;

ALTER TABLE check_results
  ADD COLUMN check_source VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
    CHECK (check_source IN ('MANUAL', 'SCHEDULED'));

CREATE INDEX check_results_scheduled_history_idx
  ON check_results (endpoint_id, checked_at DESC, id DESC)
  WHERE check_source = 'SCHEDULED';
