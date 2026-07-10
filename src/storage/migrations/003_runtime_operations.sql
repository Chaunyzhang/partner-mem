CREATE TABLE IF NOT EXISTS runtime_operation_receipts (
  operation_id TEXT NOT NULL,
  host TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (host, agent_id, operation_id),
  CHECK (operation_kind IN ('capture_turn'))
);

CREATE INDEX IF NOT EXISTS idx_runtime_operation_receipts_identity
  ON runtime_operation_receipts(agent_id, session_id, committed_at);

CREATE TABLE IF NOT EXISTS runtime_turn_counters (
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  next_turn_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, session_id),
  CHECK (next_turn_index >= 0)
);

INSERT OR IGNORE INTO runtime_turn_counters (
  agent_id,
  session_id,
  next_turn_index,
  updated_at
)
SELECT
  n.agent_id,
  n.session_id,
  MAX(p.turn_index) + 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM memory_nodes n
JOIN raw_payloads p ON p.node_id = n.node_id
WHERE n.node_type = 'raw_message'
  AND n.session_id IS NOT NULL
GROUP BY n.agent_id, n.session_id;

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('003_runtime_operations', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
