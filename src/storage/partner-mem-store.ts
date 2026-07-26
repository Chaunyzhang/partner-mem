import { randomUUID } from "node:crypto";
import {
  assertSourceObjectKind,
  optionalNonEmptyString,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type ExplicitReplyEdge,
  type HarnessInstance,
  type SourceObjectKind,
  type SourceObjectMapping,
  type TurnNode
} from "../core/contracts.js";
import type { PartnerMemDatabase } from "./schema.js";

export interface InsertTurnNodeInput {
  node_id?: string;
  harness_id: string;
  conversation_id: string;
  thread_id?: string | null;
  question_text?: string | null;
  question_role?: string | null;
  question_message_id?: string | null;
  question_author_id?: string | null;
  question_visible_at?: string | null;
  question_display_order?: number | null;
  answer_text?: string | null;
  answer_role?: string | null;
  answer_message_id?: string | null;
  answer_author_id?: string | null;
  answer_agent_id?: string | null;
  answer_visible_at?: string | null;
  answer_display_order?: number | null;
  created_at?: string;
}

export interface AttachAnswerInput {
  node_id: string;
  harness_id: string;
  conversation_id: string;
  thread_id?: string | null;
  answer_text?: string | null;
  answer_role?: string | null;
  answer_message_id?: string | null;
  answer_author_id?: string | null;
  answer_agent_id?: string | null;
  answer_visible_at?: string | null;
  answer_display_order?: number | null;
  updated_at?: string;
}

export class PartnerMemStore {
  private transactionDepth = 0;
  private savepointSequence = 0;

  constructor(private readonly db: PartnerMemDatabase) {}

  rawDatabase(): PartnerMemDatabase {
    return this.db;
  }

  transaction<T>(work: () => T): T {
    const outer = this.transactionDepth === 0;
    const savepoint = outer ? undefined : `partner_mem_${this.savepointSequence++}`;
    this.db.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec(outer ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (outer) {
        this.db.exec("ROLLBACK");
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  registerHarness(harnessType: string, now = new Date().toISOString()): HarnessInstance {
    const harness: HarnessInstance = {
      harness_id: randomUUID(),
      harness_type: requireNonEmptyString(harnessType, "harness_type"),
      registered_at: now
    };
    this.db
      .prepare(
        `INSERT INTO harness_instances(harness_id, harness_type, registered_at)
         VALUES (?, ?, ?)`
      )
      .run(harness.harness_id, harness.harness_type, harness.registered_at);
    return harness;
  }

  getHarness(harnessId: string): HarnessInstance | undefined {
    return this.db
      .prepare("SELECT * FROM harness_instances WHERE harness_id = ?")
      .get(harnessId) as HarnessInstance | undefined;
  }

  resolveSourceObject(input: {
    harness_id: string;
    object_kind: SourceObjectKind;
    source_object_id: string;
    now?: string;
  }): SourceObjectMapping {
    const harnessId = this.requireHarness(input.harness_id).harness_id;
    const objectKind = assertSourceObjectKind(input.object_kind);
    const sourceObjectId = requireNonEmptyString(input.source_object_id, "source_object_id");
    const createdAt = input.now ?? new Date().toISOString();
    const proposedFormalId = randomUUID();

    this.db
      .prepare(
        `INSERT INTO source_object_mappings(
           harness_id, object_kind, source_object_id, formal_id, created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(harness_id, object_kind, source_object_id) DO NOTHING`
      )
      .run(harnessId, objectKind, sourceObjectId, proposedFormalId, createdAt);

    const mapping = this.db
      .prepare(
        `SELECT * FROM source_object_mappings
         WHERE harness_id = ? AND object_kind = ? AND source_object_id = ?`
      )
      .get(harnessId, objectKind, sourceObjectId) as SourceObjectMapping | undefined;
    if (!mapping) throw new Error("Partner-Mem failed to resolve a source object");
    return mapping;
  }

  findSourceObject(input: {
    harness_id: string;
    object_kind: SourceObjectKind;
    source_object_id: string;
  }): SourceObjectMapping | undefined {
    return this.db
      .prepare(
        `SELECT * FROM source_object_mappings
         WHERE harness_id = ? AND object_kind = ? AND source_object_id = ?`
      )
      .get(
        requireNonEmptyString(input.harness_id, "harness_id"),
        assertSourceObjectKind(input.object_kind),
        requireNonEmptyString(input.source_object_id, "source_object_id")
      ) as SourceObjectMapping | undefined;
  }

  insertTurnNode(input: InsertTurnNodeInput): TurnNode {
    const harness = this.requireHarness(input.harness_id);
    const conversationId = this.requireFormalObject(
      harness.harness_id,
      "conversation",
      input.conversation_id,
      "conversation_id"
    );
    const threadId = this.optionalFormalObject(
      harness.harness_id,
      "thread",
      input.thread_id,
      "thread_id"
    );
    const questionText = optionalNonEmptyString(input.question_text, "question_text");
    const answerText = optionalNonEmptyString(input.answer_text, "answer_text");
    if (questionText === null && answerText === null) {
      throw new TypeError("A turn node requires question_text or answer_text");
    }

    const questionMessageId = this.optionalFormalObject(
      harness.harness_id,
      "message",
      input.question_message_id,
      "question_message_id"
    );
    const questionAuthorId = this.optionalFormalObject(
      harness.harness_id,
      "author",
      input.question_author_id,
      "question_author_id"
    );
    const answerMessageId = this.optionalFormalObject(
      harness.harness_id,
      "message",
      input.answer_message_id,
      "answer_message_id"
    );
    const answerAuthorId = this.optionalFormalObject(
      harness.harness_id,
      "author",
      input.answer_author_id,
      "answer_author_id"
    );
    const answerAgentId = this.optionalFormalObject(
      harness.harness_id,
      "agent",
      input.answer_agent_id,
      "answer_agent_id"
    );
    const createdAt = input.created_at ?? new Date().toISOString();
    const nodeId = input.node_id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO turn_nodes(
           node_id, harness_id, harness_type, conversation_id, thread_id,
           question_text, question_role, question_message_id, question_author_id,
           question_visible_at, question_display_order,
           answer_text, answer_role, answer_message_id, answer_author_id,
           answer_agent_id, answer_visible_at, answer_display_order,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nodeId,
        harness.harness_id,
        harness.harness_type,
        conversationId,
        threadId,
        questionText,
        optionalNonEmptyString(input.question_role, "question_role"),
        questionMessageId,
        questionAuthorId,
        optionalNonEmptyString(input.question_visible_at, "question_visible_at"),
        requireNonNegativeInteger(input.question_display_order, "question_display_order"),
        answerText,
        optionalNonEmptyString(input.answer_role, "answer_role"),
        answerMessageId,
        answerAuthorId,
        answerAgentId,
        optionalNonEmptyString(input.answer_visible_at, "answer_visible_at"),
        requireNonNegativeInteger(input.answer_display_order, "answer_display_order"),
        createdAt,
        createdAt
      );

    const node = this.getTurnNode(nodeId);
    if (!node) throw new Error("Partner-Mem failed to persist a turn node");
    return node;
  }

  getTurnNode(nodeId: string): TurnNode | undefined {
    return this.db
      .prepare("SELECT * FROM turn_nodes WHERE node_id = ?")
      .get(requireNonEmptyString(nodeId, "node_id")) as TurnNode | undefined;
  }

  findTurnNodeByMessageId(input: {
    harness_id: string;
    message_id: string;
  }): TurnNode | undefined {
    const messageId = requireNonEmptyString(input.message_id, "message_id");
    return this.db
      .prepare(
        `SELECT * FROM turn_nodes
         WHERE harness_id = ?
           AND (question_message_id = ? OR answer_message_id = ?)`
      )
      .get(
        requireNonEmptyString(input.harness_id, "harness_id"),
        messageId,
        messageId
      ) as TurnNode | undefined;
  }

  attachAnswer(input: AttachAnswerInput): TurnNode {
    const node = this.getTurnNode(input.node_id);
    if (!node) throw new Error(`Unknown node_id: ${input.node_id}`);
    const harness = this.requireHarness(input.harness_id);
    if (node.harness_id !== harness.harness_id) {
      throw new Error("node_id does not belong to this harness");
    }
    const conversationId = this.requireFormalObject(
      harness.harness_id,
      "conversation",
      input.conversation_id,
      "conversation_id"
    );
    if (node.conversation_id !== conversationId) {
      throw new Error("node_id does not belong to this conversation");
    }
    const threadId = this.optionalFormalObject(
      harness.harness_id,
      "thread",
      input.thread_id,
      "thread_id"
    );
    if (node.thread_id !== null && threadId !== null && node.thread_id !== threadId) {
      throw new Error("answer thread_id conflicts with the stored turn");
    }
    if (
      node.answer_text !== null ||
      node.answer_role !== null ||
      node.answer_message_id !== null ||
      node.answer_author_id !== null ||
      node.answer_agent_id !== null ||
      node.answer_visible_at !== null ||
      node.answer_display_order !== null
    ) {
      throw new Error("turn node already has answer-side fields");
    }

    const answerText = optionalNonEmptyString(input.answer_text, "answer_text");
    const answerRole = optionalNonEmptyString(input.answer_role, "answer_role");
    const answerMessageId = this.optionalFormalObject(
      harness.harness_id,
      "message",
      input.answer_message_id,
      "answer_message_id"
    );
    const answerAuthorId = this.optionalFormalObject(
      harness.harness_id,
      "author",
      input.answer_author_id,
      "answer_author_id"
    );
    const answerAgentId = this.optionalFormalObject(
      harness.harness_id,
      "agent",
      input.answer_agent_id,
      "answer_agent_id"
    );
    const answerVisibleAt = optionalNonEmptyString(
      input.answer_visible_at,
      "answer_visible_at"
    );
    const answerDisplayOrder = requireNonNegativeInteger(
      input.answer_display_order,
      "answer_display_order"
    );
    if (
      answerText === null &&
      answerRole === null &&
      answerMessageId === null &&
      answerAuthorId === null &&
      answerAgentId === null &&
      answerVisibleAt === null &&
      answerDisplayOrder === null
    ) {
      throw new Error("answer-side write requires text or host structure fields");
    }

    this.db
      .prepare(
        `UPDATE turn_nodes
         SET thread_id = COALESCE(thread_id, ?),
             answer_text = ?,
             answer_role = ?,
             answer_message_id = ?,
             answer_author_id = ?,
             answer_agent_id = ?,
             answer_visible_at = ?,
             answer_display_order = ?,
             updated_at = ?
         WHERE node_id = ?`
      )
      .run(
        threadId,
        answerText,
        answerRole,
        answerMessageId,
        answerAuthorId,
        answerAgentId,
        answerVisibleAt,
        answerDisplayOrder,
        input.updated_at ?? new Date().toISOString(),
        node.node_id
      );

    const updated = this.getTurnNode(node.node_id);
    if (!updated) throw new Error("Partner-Mem failed to attach the answer");
    return updated;
  }

  grantAgentConversationAccess(input: {
    harness_id: string;
    agent_id: string;
    conversation_id: string;
    now?: string;
  }): void {
    const harnessId = this.requireHarness(input.harness_id).harness_id;
    const agentId = this.requireFormalObject(harnessId, "agent", input.agent_id, "agent_id");
    const conversationId = this.requireFormalObject(
      harnessId,
      "conversation",
      input.conversation_id,
      "conversation_id"
    );
    this.db
      .prepare(
        `INSERT INTO agent_conversation_access(
           harness_id, agent_id, conversation_id, granted_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(harness_id, agent_id, conversation_id) DO NOTHING`
      )
      .run(harnessId, agentId, conversationId, input.now ?? new Date().toISOString());
  }

  insertExplicitReplyEdge(input: Omit<ExplicitReplyEdge, "edge_id" | "created_at"> & {
    edge_id?: string;
    created_at?: string;
  }): ExplicitReplyEdge {
    const harnessId = this.requireHarness(input.harness_id).harness_id;
    const edge: ExplicitReplyEdge = {
      edge_id: input.edge_id ?? randomUUID(),
      harness_id: harnessId,
      from_node_id: requireNonEmptyString(input.from_node_id, "from_node_id"),
      from_message_id: this.requireFormalObject(
        harnessId,
        "message",
        input.from_message_id,
        "from_message_id"
      ),
      to_node_id: requireNonEmptyString(input.to_node_id, "to_node_id"),
      to_message_id: this.requireFormalObject(
        harnessId,
        "message",
        input.to_message_id,
        "to_message_id"
      ),
      created_at: input.created_at ?? new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO explicit_reply_edges(
           edge_id, harness_id, from_node_id, from_message_id,
           to_node_id, to_message_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        edge.edge_id,
        edge.harness_id,
        edge.from_node_id,
        edge.from_message_id,
        edge.to_node_id,
        edge.to_message_id,
        edge.created_at
      );
    return edge;
  }

  findExplicitReplyEdge(input: {
    harness_id: string;
    from_message_id: string;
    to_message_id: string;
  }): ExplicitReplyEdge | undefined {
    return this.db
      .prepare(
        `SELECT * FROM explicit_reply_edges
         WHERE harness_id = ?
           AND from_message_id = ?
           AND to_message_id = ?`
      )
      .get(
        requireNonEmptyString(input.harness_id, "harness_id"),
        requireNonEmptyString(input.from_message_id, "from_message_id"),
        requireNonEmptyString(input.to_message_id, "to_message_id")
      ) as ExplicitReplyEdge | undefined;
  }

  private requireHarness(harnessId: string): HarnessInstance {
    const harness = this.getHarness(requireNonEmptyString(harnessId, "harness_id"));
    if (!harness) throw new Error(`Unknown harness_id: ${harnessId}`);
    return harness;
  }

  private requireFormalObject(
    harnessId: string,
    kind: SourceObjectKind,
    formalId: string,
    field: string
  ): string {
    const id = requireNonEmptyString(formalId, field);
    const row = this.db
      .prepare(
        `SELECT formal_id FROM source_object_mappings
         WHERE harness_id = ? AND object_kind = ? AND formal_id = ?`
      )
      .get(harnessId, kind, id);
    if (!row) throw new Error(`${field} is not a Partner-Mem ${kind} ID for this harness`);
    return id;
  }

  private optionalFormalObject(
    harnessId: string,
    kind: SourceObjectKind,
    formalId: string | null | undefined,
    field: string
  ): string | null {
    if (formalId === undefined || formalId === null) return null;
    return this.requireFormalObject(harnessId, kind, formalId, field);
  }
}
