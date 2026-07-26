CREATE TRIGGER source_object_mappings_immutable_update
BEFORE UPDATE ON source_object_mappings
BEGIN
  SELECT RAISE(ABORT, 'source object mappings are immutable');
END;

CREATE TRIGGER source_object_mappings_immutable_delete
BEFORE DELETE ON source_object_mappings
BEGIN
  SELECT RAISE(ABORT, 'source object mappings are permanent');
END;

CREATE TRIGGER turn_nodes_immutable_identity
BEFORE UPDATE OF node_id, harness_id, harness_type, conversation_id, created_at
ON turn_nodes
WHEN NEW.node_id IS NOT OLD.node_id
  OR NEW.harness_id IS NOT OLD.harness_id
  OR NEW.harness_type IS NOT OLD.harness_type
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'turn node identity is immutable');
END;

CREATE TRIGGER turn_nodes_thread_fill_once
BEFORE UPDATE OF thread_id ON turn_nodes
WHEN OLD.thread_id IS NOT NULL
  AND NEW.thread_id IS NOT OLD.thread_id
BEGIN
  SELECT RAISE(ABORT, 'turn node thread_id cannot be replaced');
END;

CREATE TRIGGER turn_nodes_immutable_question
BEFORE UPDATE OF
  question_text, question_role, question_message_id, question_author_id,
  question_visible_at, question_display_order
ON turn_nodes
WHEN NEW.question_text IS NOT OLD.question_text
  OR NEW.question_role IS NOT OLD.question_role
  OR NEW.question_message_id IS NOT OLD.question_message_id
  OR NEW.question_author_id IS NOT OLD.question_author_id
  OR NEW.question_visible_at IS NOT OLD.question_visible_at
  OR NEW.question_display_order IS NOT OLD.question_display_order
BEGIN
  SELECT RAISE(ABORT, 'stored question fields are immutable');
END;

CREATE TRIGGER turn_nodes_immutable_answer
BEFORE UPDATE OF
  answer_text, answer_role, answer_message_id, answer_author_id,
  answer_agent_id, answer_visible_at, answer_display_order
ON turn_nodes
WHEN (
    OLD.answer_text IS NOT NULL
    OR OLD.answer_role IS NOT NULL
    OR OLD.answer_message_id IS NOT NULL
    OR OLD.answer_author_id IS NOT NULL
    OR OLD.answer_agent_id IS NOT NULL
    OR OLD.answer_visible_at IS NOT NULL
    OR OLD.answer_display_order IS NOT NULL
  )
  AND (
    NEW.answer_text IS NOT OLD.answer_text
    OR NEW.answer_role IS NOT OLD.answer_role
    OR NEW.answer_message_id IS NOT OLD.answer_message_id
    OR NEW.answer_author_id IS NOT OLD.answer_author_id
    OR NEW.answer_agent_id IS NOT OLD.answer_agent_id
    OR NEW.answer_visible_at IS NOT OLD.answer_visible_at
    OR NEW.answer_display_order IS NOT OLD.answer_display_order
  )
BEGIN
  SELECT RAISE(ABORT, 'stored answer fields are immutable');
END;

CREATE TRIGGER turn_nodes_permanent
BEFORE DELETE ON turn_nodes
BEGIN
  SELECT RAISE(ABORT, 'turn nodes are permanent');
END;

CREATE TRIGGER explicit_reply_edges_immutable_update
BEFORE UPDATE ON explicit_reply_edges
BEGIN
  SELECT RAISE(ABORT, 'explicit reply edges are immutable');
END;

CREATE TRIGGER explicit_reply_edges_permanent
BEFORE DELETE ON explicit_reply_edges
BEGIN
  SELECT RAISE(ABORT, 'explicit reply edges are permanent');
END;

INSERT INTO schema_migrations(version, applied_at)
VALUES ('002_v1_immutability', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
