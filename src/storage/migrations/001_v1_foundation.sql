PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE harness_instances (
  harness_id TEXT PRIMARY KEY,
  harness_type TEXT NOT NULL CHECK (length(trim(harness_type)) > 0),
  registered_at TEXT NOT NULL
) STRICT;

CREATE TABLE source_object_mappings (
  harness_id TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  source_object_id TEXT NOT NULL CHECK (length(trim(source_object_id)) > 0),
  formal_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (harness_id, object_kind, source_object_id),
  FOREIGN KEY (harness_id) REFERENCES harness_instances(harness_id) ON DELETE RESTRICT,
  CHECK (object_kind IN ('conversation', 'thread', 'message', 'author', 'agent'))
) STRICT;

CREATE INDEX idx_source_object_formal
  ON source_object_mappings(harness_id, object_kind, formal_id);

CREATE TABLE turn_nodes (
  node_id TEXT PRIMARY KEY,
  harness_id TEXT NOT NULL,
  harness_type TEXT NOT NULL CHECK (length(trim(harness_type)) > 0),
  conversation_id TEXT NOT NULL,
  thread_id TEXT,
  question_text TEXT CHECK (question_text IS NULL OR length(question_text) > 0),
  question_role TEXT CHECK (question_role IS NULL OR length(trim(question_role)) > 0),
  question_message_id TEXT,
  question_author_id TEXT,
  question_visible_at TEXT,
  question_display_order INTEGER CHECK (
    question_display_order IS NULL OR question_display_order >= 0
  ),
  answer_text TEXT CHECK (answer_text IS NULL OR length(answer_text) > 0),
  answer_role TEXT CHECK (answer_role IS NULL OR length(trim(answer_role)) > 0),
  answer_message_id TEXT,
  answer_author_id TEXT,
  answer_agent_id TEXT,
  answer_visible_at TEXT,
  answer_display_order INTEGER CHECK (
    answer_display_order IS NULL OR answer_display_order >= 0
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (harness_id) REFERENCES harness_instances(harness_id) ON DELETE RESTRICT,
  CHECK (question_text IS NOT NULL OR answer_text IS NOT NULL),
  CHECK (question_message_id IS NULL OR question_message_id <> answer_message_id)
) STRICT;

CREATE INDEX idx_turn_nodes_conversation
  ON turn_nodes(harness_id, conversation_id);

CREATE INDEX idx_turn_nodes_thread
  ON turn_nodes(harness_id, thread_id);

CREATE INDEX idx_turn_nodes_question_message
  ON turn_nodes(question_message_id)
  WHERE question_message_id IS NOT NULL;

CREATE INDEX idx_turn_nodes_answer_message
  ON turn_nodes(answer_message_id)
  WHERE answer_message_id IS NOT NULL;

CREATE TRIGGER turn_nodes_validate_formal_ids_insert
BEFORE INSERT ON turn_nodes
WHEN NOT EXISTS (
    SELECT 1 FROM harness_instances
    WHERE harness_id = NEW.harness_id
      AND harness_type = NEW.harness_type
  )
  OR NOT EXISTS (
    SELECT 1 FROM source_object_mappings
    WHERE harness_id = NEW.harness_id
      AND object_kind = 'conversation'
      AND formal_id = NEW.conversation_id
  )
  OR (
    NEW.thread_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'thread'
        AND formal_id = NEW.thread_id
    )
  )
  OR (
    NEW.question_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'message'
        AND formal_id = NEW.question_message_id
    )
  )
  OR (
    NEW.question_author_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'author'
        AND formal_id = NEW.question_author_id
    )
  )
  OR (
    NEW.answer_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'message'
        AND formal_id = NEW.answer_message_id
    )
  )
  OR (
    NEW.answer_author_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'author'
        AND formal_id = NEW.answer_author_id
    )
  )
  OR (
    NEW.answer_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'agent'
        AND formal_id = NEW.answer_agent_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'turn node identifiers must be Partner-Mem formal IDs');
END;

CREATE TRIGGER turn_nodes_validate_formal_ids_update
BEFORE UPDATE OF
  harness_id, harness_type, conversation_id, thread_id,
  question_message_id, question_author_id,
  answer_message_id, answer_author_id, answer_agent_id
ON turn_nodes
WHEN NOT EXISTS (
    SELECT 1 FROM harness_instances
    WHERE harness_id = NEW.harness_id
      AND harness_type = NEW.harness_type
  )
  OR NOT EXISTS (
    SELECT 1 FROM source_object_mappings
    WHERE harness_id = NEW.harness_id
      AND object_kind = 'conversation'
      AND formal_id = NEW.conversation_id
  )
  OR (
    NEW.thread_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'thread'
        AND formal_id = NEW.thread_id
    )
  )
  OR (
    NEW.question_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'message'
        AND formal_id = NEW.question_message_id
    )
  )
  OR (
    NEW.question_author_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'author'
        AND formal_id = NEW.question_author_id
    )
  )
  OR (
    NEW.answer_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'message'
        AND formal_id = NEW.answer_message_id
    )
  )
  OR (
    NEW.answer_author_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'author'
        AND formal_id = NEW.answer_author_id
    )
  )
  OR (
    NEW.answer_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM source_object_mappings
      WHERE harness_id = NEW.harness_id
        AND object_kind = 'agent'
        AND formal_id = NEW.answer_agent_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'turn node identifiers must be Partner-Mem formal IDs');
END;

CREATE TRIGGER turn_nodes_unique_question_message_insert
BEFORE INSERT ON turn_nodes
WHEN NEW.question_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM turn_nodes
    WHERE question_message_id = NEW.question_message_id
       OR answer_message_id = NEW.question_message_id
  )
BEGIN
  SELECT RAISE(ABORT, 'message_id already belongs to a turn node');
END;

CREATE TRIGGER turn_nodes_unique_answer_message_insert
BEFORE INSERT ON turn_nodes
WHEN NEW.answer_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM turn_nodes
    WHERE question_message_id = NEW.answer_message_id
       OR answer_message_id = NEW.answer_message_id
  )
BEGIN
  SELECT RAISE(ABORT, 'message_id already belongs to a turn node');
END;

CREATE TRIGGER turn_nodes_unique_answer_message_update
BEFORE UPDATE OF answer_message_id ON turn_nodes
WHEN NEW.answer_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM turn_nodes
    WHERE node_id <> OLD.node_id
      AND (
        question_message_id = NEW.answer_message_id
        OR answer_message_id = NEW.answer_message_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'message_id already belongs to a turn node');
END;

CREATE TABLE explicit_reply_edges (
  edge_id TEXT PRIMARY KEY,
  harness_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  from_message_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  to_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (harness_id) REFERENCES harness_instances(harness_id) ON DELETE RESTRICT,
  FOREIGN KEY (from_node_id) REFERENCES turn_nodes(node_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_node_id) REFERENCES turn_nodes(node_id) ON DELETE RESTRICT,
  UNIQUE (from_message_id, to_message_id),
  CHECK (from_node_id <> to_node_id),
  CHECK (from_message_id <> to_message_id)
) STRICT;

CREATE INDEX idx_reply_edges_from
  ON explicit_reply_edges(harness_id, from_node_id);

CREATE INDEX idx_reply_edges_to
  ON explicit_reply_edges(harness_id, to_node_id);

CREATE TRIGGER reply_edges_validate_endpoints
BEFORE INSERT ON explicit_reply_edges
WHEN NOT EXISTS (
    SELECT 1
    FROM turn_nodes
    WHERE node_id = NEW.from_node_id
      AND harness_id = NEW.harness_id
      AND (
        (question_message_id = NEW.from_message_id AND question_text IS NOT NULL)
        OR
        (answer_message_id = NEW.from_message_id AND answer_text IS NOT NULL)
      )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM turn_nodes
    WHERE node_id = NEW.to_node_id
      AND harness_id = NEW.harness_id
      AND (
        (question_message_id = NEW.to_message_id AND question_text IS NOT NULL)
        OR
        (answer_message_id = NEW.to_message_id AND answer_text IS NOT NULL)
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'reply edge endpoint must resolve to stored message text');
END;

CREATE TABLE agent_conversation_access (
  harness_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (harness_id, agent_id, conversation_id),
  FOREIGN KEY (harness_id) REFERENCES harness_instances(harness_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER agent_conversation_access_validate_formal_ids
BEFORE INSERT ON agent_conversation_access
WHEN NOT EXISTS (
    SELECT 1 FROM source_object_mappings
    WHERE harness_id = NEW.harness_id
      AND object_kind = 'agent'
      AND formal_id = NEW.agent_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM source_object_mappings
    WHERE harness_id = NEW.harness_id
      AND object_kind = 'conversation'
      AND formal_id = NEW.conversation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'access identifiers must be Partner-Mem formal IDs');
END;

INSERT INTO schema_migrations(version, applied_at)
VALUES ('001_v1_foundation', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
