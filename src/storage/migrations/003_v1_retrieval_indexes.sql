CREATE VIRTUAL TABLE turn_fts USING fts5(
  node_id UNINDEXED,
  harness_id UNINDEXED,
  conversation_id UNINDEXED,
  search_text,
  tokenize = 'trigram'
);

INSERT INTO turn_fts(node_id, harness_id, conversation_id, search_text)
SELECT
  node_id,
  harness_id,
  conversation_id,
  CASE
    WHEN question_text IS NOT NULL AND answer_text IS NOT NULL
      THEN question_text || char(10) || answer_text
    ELSE COALESCE(question_text, answer_text)
  END
FROM turn_nodes;

CREATE TRIGGER turn_nodes_fts_insert
AFTER INSERT ON turn_nodes
BEGIN
  INSERT INTO turn_fts(node_id, harness_id, conversation_id, search_text)
  VALUES (
    NEW.node_id,
    NEW.harness_id,
    NEW.conversation_id,
    CASE
      WHEN NEW.question_text IS NOT NULL AND NEW.answer_text IS NOT NULL
        THEN NEW.question_text || char(10) || NEW.answer_text
      ELSE COALESCE(NEW.question_text, NEW.answer_text)
    END
  );
END;

CREATE TRIGGER turn_nodes_fts_answer_update
AFTER UPDATE OF answer_text ON turn_nodes
WHEN NEW.answer_text IS NOT OLD.answer_text
BEGIN
  DELETE FROM turn_fts WHERE node_id = OLD.node_id;
  INSERT INTO turn_fts(node_id, harness_id, conversation_id, search_text)
  VALUES (
    NEW.node_id,
    NEW.harness_id,
    NEW.conversation_id,
    CASE
      WHEN NEW.question_text IS NOT NULL AND NEW.answer_text IS NOT NULL
        THEN NEW.question_text || char(10) || NEW.answer_text
      ELSE COALESCE(NEW.question_text, NEW.answer_text)
    END
  );
END;

CREATE TABLE node_vectors (
  node_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  vector BLOB NOT NULL CHECK (length(vector) = dimensions * 4),
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES turn_nodes(node_id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER turn_nodes_vector_invalidate
AFTER UPDATE OF answer_text ON turn_nodes
WHEN NEW.answer_text IS NOT OLD.answer_text
BEGIN
  DELETE FROM node_vectors WHERE node_id = NEW.node_id;
END;

INSERT INTO schema_migrations(version, applied_at)
VALUES ('003_v1_retrieval_indexes', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
