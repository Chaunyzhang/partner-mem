PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_nodes (
  node_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  observed_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  invalidated_at TEXT,
  topic_group TEXT,
  sequence INTEGER,
  supersedes TEXT,
  superseded_by TEXT,
  content_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (supersedes) REFERENCES memory_nodes(node_id) ON DELETE SET NULL,
  FOREIGN KEY (superseded_by) REFERENCES memory_nodes(node_id) ON DELETE SET NULL,
  CHECK (node_type IN ('raw_message', 'summary', 'entity', 'task', 'event', 'decision', 'artifact')),
  CHECK (status IN ('active', 'invalidated')),
  CHECK (
    (topic_group IS NULL AND sequence IS NULL) OR
    (topic_group IS NOT NULL AND sequence IS NOT NULL AND sequence > 0)
  ),
  CHECK (supersedes IS NULL OR supersedes <> node_id),
  CHECK (superseded_by IS NULL OR superseded_by <> node_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_agent_session
  ON memory_nodes(agent_id, session_id);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_type_status
  ON memory_nodes(node_type, status);

CREATE TABLE IF NOT EXISTS memory_edges (
  edge_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  edge_class TEXT NOT NULL,
  created_at TEXT NOT NULL,
  observed_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  invalidated_at TEXT,
  target_hash TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (from_node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE,
  CHECK (edge_class IN ('evidence', 'semantic', 'temporal', 'navigation')),
  CHECK (edge_type IN (
    'RAW_NEAR_RAW',
    'SUMMARY_COVERS_RAW',
    'SUMMARY_ROLLS_UP_SUMMARY',
    'MENTIONED_IN_RAW',
    'EVIDENCED_BY_RAW',
    'RELATED_TO',
    'SIMILAR_TO',
    'CAUSED_BY',
    'USED_TOOL',
    'SOLVED_BY',
    'correction',
    'extension',
    'contradiction',
    'FOLLOWS',
    'INDEXES',
    'ROLLS_UP'
  ))
);

CREATE INDEX IF NOT EXISTS idx_memory_edges_from_class_type
  ON memory_edges(from_node_id, edge_class, edge_type);

CREATE INDEX IF NOT EXISTS idx_memory_edges_to_class_type
  ON memory_edges(to_node_id, edge_class, edge_type);

CREATE INDEX IF NOT EXISTS idx_memory_edges_class_type
  ON memory_edges(edge_class, edge_type);

CREATE TABLE IF NOT EXISTS raw_payloads (
  node_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  turn_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  message_index INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE,
  CHECK (role IN ('user', 'assistant', 'system_visible', 'tool_visible'))
);

CREATE TABLE IF NOT EXISTS summary_payloads (
  node_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source_node_count INTEGER NOT NULL DEFAULT 0,
  summary_hash TEXT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
  node_id UNINDEXED,
  agent_id UNINDEXED,
  session_id UNINDEXED,
  node_type UNINDEXED,
  text,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS retrieval_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  query TEXT,
  result_class TEXT NOT NULL,
  seed_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (result_class IN ('candidate', 'evidence', 'status'))
);

CREATE TABLE IF NOT EXISTS evidence_packets (
  packet_id TEXT PRIMARY KEY,
  query_id TEXT,
  candidate_node_id TEXT,
  result_class TEXT NOT NULL DEFAULT 'evidence',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (result_class IN ('evidence', 'status'))
);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('001_init_graph', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
