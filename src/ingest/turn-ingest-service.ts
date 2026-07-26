import type { ExplicitReplyEdge, SourceObjectKind, TurnNode } from "../core/contracts.js";
import { optionalNonEmptyString, requireNonEmptyString } from "../core/contracts.js";
import type { PartnerMemStore } from "../storage/partner-mem-store.js";

interface SourceTurnFields {
  harness_id: string;
  source_conversation_id: string;
  source_thread_id?: string | null | undefined;
}

interface SourceMessageMetadata {
  role?: string | null | undefined;
  source_message_id?: string | null | undefined;
  source_author_id?: string | null | undefined;
  visible_at?: string | null | undefined;
  display_order?: number | null | undefined;
}

interface SourceMessageFields extends SourceMessageMetadata {
  text: string;
}

export interface RecordQuestionInput extends SourceTurnFields, SourceMessageFields {
  source_access_agent_id?: string | null | undefined;
}

export interface RecordAnswerInput extends SourceTurnFields, SourceMessageMetadata {
  text?: string | null | undefined;
  node_id?: string | null | undefined;
  question_source_message_id?: string | null | undefined;
  question_was_absent?: boolean | undefined;
  question_role?: string | null | undefined;
  question_source_author_id?: string | null | undefined;
  question_visible_at?: string | null | undefined;
  question_display_order?: number | null | undefined;
  source_agent_id?: string | null | undefined;
  source_access_agent_id?: string | null | undefined;
}

export interface RecordReplyInput {
  harness_id: string;
  from_source_message_id: string;
  to_source_message_id: string;
}

export class TurnIngestService {
  constructor(
    private readonly store: PartnerMemStore,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  recordQuestion(input: RecordQuestionInput): TurnNode {
    return this.store.transaction(() => {
      const now = this.clock();
      const harnessId = requireNonEmptyString(input.harness_id, "harness_id");
      const conversationId = this.resolveRequired(
        harnessId,
        "conversation",
        input.source_conversation_id,
        now
      );
      const threadId = this.resolveOptional(
        harnessId,
        "thread",
        input.source_thread_id,
        now
      );
      const messageId = this.resolveOptional(
        harnessId,
        "message",
        input.source_message_id,
        now
      );
      const authorId = this.resolveOptional(
        harnessId,
        "author",
        input.source_author_id,
        now
      );
      const accessAgentId = this.resolveOptional(
        harnessId,
        "agent",
        input.source_access_agent_id,
        now
      );

      if (messageId !== null) {
        const existing = this.store.findTurnNodeByMessageId({
          harness_id: harnessId,
          message_id: messageId
        });
        if (existing) {
          if (
            existing.question_message_id === messageId &&
            this.questionMatches(existing, {
              conversation_id: conversationId,
              thread_id: threadId,
              text: input.text,
              role: input.role ?? null,
              author_id: authorId,
              visible_at: input.visible_at ?? null,
              display_order: input.display_order ?? null
            })
          ) {
            this.grantConversationAccess(
              harnessId,
              accessAgentId,
              conversationId,
              now
            );
            return existing;
          }
          throw new Error("source question message conflicts with an existing turn node");
        }
      }

      const node = this.store.insertTurnNode({
        harness_id: harnessId,
        conversation_id: conversationId,
        thread_id: threadId,
        question_text: input.text,
        question_role: input.role ?? null,
        question_message_id: messageId,
        question_author_id: authorId,
        question_visible_at: input.visible_at ?? null,
        question_display_order: input.display_order ?? null,
        created_at: now
      });
      this.grantConversationAccess(harnessId, accessAgentId, conversationId, now);
      return node;
    });
  }

  recordAnswer(input: RecordAnswerInput): TurnNode {
    return this.store.transaction(() => {
      const now = this.clock();
      const harnessId = requireNonEmptyString(input.harness_id, "harness_id");
      const answerText = optionalNonEmptyString(input.text, "text");
      const conversationId = this.resolveRequired(
        harnessId,
        "conversation",
        input.source_conversation_id,
        now
      );
      const threadId = this.resolveOptional(
        harnessId,
        "thread",
        input.source_thread_id,
        now
      );
      const answerMessageId = this.resolveOptional(
        harnessId,
        "message",
        input.source_message_id,
        now
      );
      const answerAuthorId = this.resolveOptional(
        harnessId,
        "author",
        input.source_author_id,
        now
      );
      const answerAgentId = this.resolveOptional(
        harnessId,
        "agent",
        input.source_agent_id,
        now
      );
      const accessAgentId = this.resolveOptional(
        harnessId,
        "agent",
        input.source_access_agent_id,
        now
      );

      const nodeId = input.node_id ?? null;
      const questionSourceMessageId = input.question_source_message_id ?? null;
      const questionWasAbsent = input.question_was_absent === true;
      if (questionWasAbsent && nodeId !== null) {
        throw new Error("question_was_absent cannot be combined with node_id");
      }
      if (
        !questionWasAbsent &&
        (input.question_role != null ||
          input.question_source_author_id != null ||
          input.question_visible_at != null ||
          input.question_display_order != null)
      ) {
        throw new Error(
          "question-side metadata without text requires question_was_absent"
        );
      }

      const directNode =
        nodeId === null
          ? undefined
          : this.store.getTurnNode(requireNonEmptyString(nodeId, "node_id"));
      if (nodeId !== null && !directNode) throw new Error(`Unknown node_id: ${nodeId}`);

      let anchoredNode: TurnNode | undefined;
      if (!questionWasAbsent && questionSourceMessageId !== null) {
        const questionMapping = this.store.findSourceObject({
          harness_id: harnessId,
          object_kind: "message",
          source_object_id: questionSourceMessageId
        });
        if (!questionMapping) {
          throw new Error("question source message has no persisted Partner-Mem mapping");
        }
        anchoredNode = this.store.findTurnNodeByMessageId({
          harness_id: harnessId,
          message_id: questionMapping.formal_id
        });
        if (!anchoredNode || anchoredNode.question_message_id !== questionMapping.formal_id) {
          throw new Error("question source message does not resolve to a stored question");
        }
      }

      const absentQuestionMessageId = questionWasAbsent
        ? this.resolveOptional(
            harnessId,
            "message",
            questionSourceMessageId,
            now
          )
        : null;
      const absentQuestionAuthorId = questionWasAbsent
        ? this.resolveOptional(
            harnessId,
            "author",
            input.question_source_author_id,
            now
          )
        : null;
      const absentQuestionNode =
        absentQuestionMessageId === null
          ? undefined
          : this.store.findTurnNodeByMessageId({
              harness_id: harnessId,
              message_id: absentQuestionMessageId
            });
      if (absentQuestionNode?.question_text !== null && absentQuestionNode !== undefined) {
        throw new Error(
          "question_was_absent conflicts with a stored question message"
        );
      }

      if (directNode && anchoredNode && directNode.node_id !== anchoredNode.node_id) {
        throw new Error("node_id and question source message resolve to different turns");
      }

      const existingAnswerNode =
        answerMessageId === null
          ? undefined
          : this.store.findTurnNodeByMessageId({
              harness_id: harnessId,
              message_id: answerMessageId
            });
      let target = directNode ?? anchoredNode ?? absentQuestionNode;
      if (!target && existingAnswerNode?.answer_message_id === answerMessageId) {
        target = existingAnswerNode;
      }

      if (!target) {
        if (!questionWasAbsent) {
          throw new Error(
            "record_answer requires an exact node/message anchor or question_was_absent"
          );
        }
        if (answerText === null) {
          throw new Error("a turn node requires question text or answer text");
        }
        const answerOnly = this.store.insertTurnNode({
          harness_id: harnessId,
          conversation_id: conversationId,
          thread_id: threadId,
          question_role: input.question_role ?? null,
          question_message_id: absentQuestionMessageId,
          question_author_id: absentQuestionAuthorId,
          question_visible_at: input.question_visible_at ?? null,
          question_display_order: input.question_display_order ?? null,
          answer_text: answerText,
          answer_role: input.role ?? null,
          answer_message_id: answerMessageId,
          answer_author_id: answerAuthorId,
          answer_agent_id: answerAgentId,
          answer_visible_at: input.visible_at ?? null,
          answer_display_order: input.display_order ?? null,
          created_at: now
        });
        this.grantConversationAccess(
          harnessId,
          accessAgentId,
          conversationId,
          now
        );
        return answerOnly;
      }

      this.assertTurnBoundary(target, harnessId, conversationId, threadId);
      if (
        questionWasAbsent &&
        !this.absentQuestionMatches(target, {
          message_id: absentQuestionMessageId,
          role: input.question_role ?? null,
          author_id: absentQuestionAuthorId,
          visible_at: input.question_visible_at ?? null,
          display_order: input.question_display_order ?? null
        })
      ) {
        throw new Error("question_was_absent metadata conflicts with the stored turn");
      }
      if (existingAnswerNode && existingAnswerNode.node_id !== target.node_id) {
        throw new Error("source answer message already belongs to a different turn node");
      }

      if (this.hasAnswerSide(target)) {
        if (
          this.answerMatches(target, {
            thread_id: threadId,
            text: answerText,
            role: input.role ?? null,
            message_id: answerMessageId,
            author_id: answerAuthorId,
            agent_id: answerAgentId,
            visible_at: input.visible_at ?? null,
            display_order: input.display_order ?? null
          })
        ) {
          this.grantConversationAccess(
            harnessId,
            accessAgentId,
            conversationId,
            now
          );
          return target;
        }
        throw new Error("turn node already has a different answer");
      }

      const updated = this.store.attachAnswer({
        node_id: target.node_id,
        harness_id: harnessId,
        conversation_id: conversationId,
        thread_id: threadId,
        answer_text: answerText,
        answer_role: input.role ?? null,
        answer_message_id: answerMessageId,
        answer_author_id: answerAuthorId,
        answer_agent_id: answerAgentId,
        answer_visible_at: input.visible_at ?? null,
        answer_display_order: input.display_order ?? null,
        updated_at: now
      });
      this.grantConversationAccess(harnessId, accessAgentId, conversationId, now);
      return updated;
    });
  }

  recordReply(input: RecordReplyInput): ExplicitReplyEdge {
    return this.store.transaction(() => {
      const harnessId = requireNonEmptyString(input.harness_id, "harness_id");
      const fromMapping = this.requireExistingMessageMapping(
        harnessId,
        input.from_source_message_id,
        "from_source_message_id"
      );
      const toMapping = this.requireExistingMessageMapping(
        harnessId,
        input.to_source_message_id,
        "to_source_message_id"
      );
      const fromNode = this.store.findTurnNodeByMessageId({
        harness_id: harnessId,
        message_id: fromMapping
      });
      const toNode = this.store.findTurnNodeByMessageId({
        harness_id: harnessId,
        message_id: toMapping
      });
      if (!fromNode || !this.nodeContainsStoredText(fromNode, fromMapping)) {
        throw new Error("reply source message does not resolve to stored text");
      }
      if (!toNode || !this.nodeContainsStoredText(toNode, toMapping)) {
        throw new Error("reply target message does not resolve to stored text");
      }

      const existing = this.store.findExplicitReplyEdge({
        harness_id: harnessId,
        from_message_id: fromMapping,
        to_message_id: toMapping
      });
      if (existing) return existing;

      return this.store.insertExplicitReplyEdge({
        harness_id: harnessId,
        from_node_id: fromNode.node_id,
        from_message_id: fromMapping,
        to_node_id: toNode.node_id,
        to_message_id: toMapping,
        created_at: this.clock()
      });
    });
  }

  private resolveRequired(
    harnessId: string,
    kind: SourceObjectKind,
    sourceObjectId: string,
    now: string
  ): string {
    return this.store.resolveSourceObject({
      harness_id: harnessId,
      object_kind: kind,
      source_object_id: sourceObjectId,
      now
    }).formal_id;
  }

  private resolveOptional(
    harnessId: string,
    kind: SourceObjectKind,
    sourceObjectId: string | null | undefined,
    now: string
  ): string | null {
    if (sourceObjectId === undefined || sourceObjectId === null) return null;
    return this.resolveRequired(harnessId, kind, sourceObjectId, now);
  }

  private requireExistingMessageMapping(
    harnessId: string,
    sourceMessageId: string,
    field: string
  ): string {
    const mapping = this.store.findSourceObject({
      harness_id: harnessId,
      object_kind: "message",
      source_object_id: requireNonEmptyString(sourceMessageId, field)
    });
    if (!mapping) throw new Error(`${field} has no persisted Partner-Mem mapping`);
    return mapping.formal_id;
  }

  private questionMatches(
    node: TurnNode,
    expected: {
      conversation_id: string;
      thread_id: string | null;
      text: string | null;
      role: string | null;
      author_id: string | null;
      visible_at: string | null;
      display_order: number | null;
    }
  ): boolean {
    return (
      node.conversation_id === expected.conversation_id &&
      node.thread_id === expected.thread_id &&
      node.question_text === expected.text &&
      node.question_role === expected.role &&
      node.question_author_id === expected.author_id &&
      node.question_visible_at === expected.visible_at &&
      node.question_display_order === expected.display_order
    );
  }

  private answerMatches(
    node: TurnNode,
    expected: {
      thread_id: string | null;
      text: string | null;
      role: string | null;
      message_id: string | null;
      author_id: string | null;
      agent_id: string | null;
      visible_at: string | null;
      display_order: number | null;
    }
  ): boolean {
    return (
      (node.thread_id === expected.thread_id ||
        (node.thread_id !== null && expected.thread_id === null)) &&
      node.answer_text === expected.text &&
      node.answer_role === expected.role &&
      node.answer_message_id === expected.message_id &&
      node.answer_author_id === expected.author_id &&
      node.answer_agent_id === expected.agent_id &&
      node.answer_visible_at === expected.visible_at &&
      node.answer_display_order === expected.display_order
    );
  }

  private absentQuestionMatches(
    node: TurnNode,
    expected: {
      message_id: string | null;
      role: string | null;
      author_id: string | null;
      visible_at: string | null;
      display_order: number | null;
    }
  ): boolean {
    return (
      node.question_text === null &&
      node.question_message_id === expected.message_id &&
      node.question_role === expected.role &&
      node.question_author_id === expected.author_id &&
      node.question_visible_at === expected.visible_at &&
      node.question_display_order === expected.display_order
    );
  }

  private hasAnswerSide(node: TurnNode): boolean {
    return (
      node.answer_text !== null ||
      node.answer_role !== null ||
      node.answer_message_id !== null ||
      node.answer_author_id !== null ||
      node.answer_agent_id !== null ||
      node.answer_visible_at !== null ||
      node.answer_display_order !== null
    );
  }

  private assertTurnBoundary(
    node: TurnNode,
    harnessId: string,
    conversationId: string,
    threadId: string | null
  ): void {
    if (node.harness_id !== harnessId) {
      throw new Error("turn node belongs to a different harness");
    }
    if (node.conversation_id !== conversationId) {
      throw new Error("turn node belongs to a different conversation");
    }
    if (node.thread_id !== null && threadId !== null && node.thread_id !== threadId) {
      throw new Error("turn node belongs to a different thread");
    }
  }

  private grantConversationAccess(
    harnessId: string,
    accessAgentId: string | null,
    conversationId: string,
    now: string
  ): void {
    if (accessAgentId === null) return;
    this.store.grantAgentConversationAccess({
      harness_id: harnessId,
      agent_id: accessAgentId,
      conversation_id: conversationId,
      now
    });
  }

  private nodeContainsStoredText(node: TurnNode, messageId: string): boolean {
    return (
      (node.question_message_id === messageId && node.question_text !== null) ||
      (node.answer_message_id === messageId && node.answer_text !== null)
    );
  }
}
