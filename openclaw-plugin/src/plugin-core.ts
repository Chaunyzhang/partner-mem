import { HarnessStateStore } from "./state.js";
import { SessionSerialQueue } from "./queue.js";
import { RuntimeTransportError, type RuntimeClient } from "./runtime-client.js";
import { unavailableEnvelope } from "./error-envelope.js";
import { isPartnerMemToolName, type PartnerMemToolName } from "./tool-schemas.js";

export interface MessageContextLike {
  sessionKey?: string;
  runId?: string;
  messageId?: string;
  senderId?: string;
  agentId?: string;
  trigger?: string;
  replyToId?: string;
  threadId?: string | number;
}

export interface MessageReceivedEventLike {
  content: string;
  timestamp?: number;
  threadId?: string | number;
  messageId?: string;
  senderId?: string;
  replyToId?: string;
  sessionKey?: string;
  runId?: string;
}

export interface MessageSentEventLike {
  content: string;
  success: boolean;
  threadId?: string | number;
  messageId?: string;
  sessionKey?: string;
  runId?: string;
}

export interface ReplyPayloadSendingEventLike {
  text?: string;
  spokenText?: string;
  hasMedia: boolean;
  isReasoning: boolean;
  isCommentary: boolean;
  isStatusNotice: boolean;
  isCompactionNotice: boolean;
  isFallbackNotice: boolean;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
}

export interface PartnerMemOpenClawAdapterOptions {
  client: Pick<
    RuntimeClient,
    "recordQuestion" | "recordAnswer" | "recordReply" | "invokeTool" | "close"
  >;
  stateStore: HarnessStateStore;
  logger?: Pick<Console, "warn" | "error">;
}

interface PendingQuestion {
  sourceMessageId?: string;
  nodeId: Promise<string>;
  consumed: boolean;
}

interface OutboundVisibility {
  runId?: string;
  visibleText?: string;
  hiddenSpokenText?: string;
  agentId?: string;
  questionWasAbsent: boolean;
  consumed: boolean;
}

interface ProactiveRunProof {
  runId: string;
  agentId?: string;
  consumed: boolean;
}

export class PartnerMemOpenClawAdapter {
  private readonly queue = new SessionSerialQueue();
  private readonly pendingBySession = new Map<string, PendingQuestion[]>();
  private readonly visibilityBySession = new Map<string, OutboundVisibility[]>();
  private readonly proactiveBySession = new Map<string, ProactiveRunProof[]>();
  private readonly logger: Pick<Console, "warn" | "error">;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly options: PartnerMemOpenClawAdapterOptions) {
    this.logger = options.logger ?? console;
  }

  start(): void {
    this.readyPromise ??= this.options.stateStore.ensure().then(() => undefined);
  }

  onBeforeAgentRun(ctx: MessageContextLike): void {
    if (ctx.trigger !== "cron" && ctx.trigger !== "heartbeat") {
      return;
    }
    const sessionKey = nonEmptyString(ctx.sessionKey);
    const runId = nonEmptyString(ctx.runId);
    if (!sessionKey || !runId) {
      return;
    }
    const entries = this.proactiveBySession.get(sessionKey) ?? [];
    if (entries.some((entry) => entry.runId === runId)) {
      return;
    }
    entries.push({
      runId,
      ...optionalField("agentId", nonEmptyString(ctx.agentId)),
      consumed: false
    });
    if (entries.length > 64) {
      entries.splice(0, entries.length - 64);
    }
    this.proactiveBySession.set(sessionKey, entries);
  }

  onMessageReceived(event: MessageReceivedEventLike, ctx: MessageContextLike): void {
    const content = visibleText(event.content);
    const sessionKey = sourceConversationId(event, ctx);
    if (!content || !sessionKey) {
      return;
    }
    const sourceMessageId = nonEmptyString(event.messageId ?? ctx.messageId);
    if (
      sourceMessageId &&
      (this.pendingBySession.get(sessionKey) ?? []).some(
        (entry) => entry.sourceMessageId === sourceMessageId
      )
    ) {
      return;
    }
    const pending: PendingQuestion = {
      ...optionalField("sourceMessageId", sourceMessageId),
      nodeId: this.enqueueQuestion({ event, ctx, sessionKey, content }),
      consumed: false
    };
    pending.nodeId.catch(() => undefined);
    this.rememberPending(sessionKey, pending);
  }

  onReplyPayloadSending(
    event: ReplyPayloadSendingEventLike,
    ctx: MessageContextLike
  ): void {
    const sessionKey = sourceConversationId(event, ctx);
    if (!sessionKey) {
      return;
    }
    const suppressed =
      event.isReasoning ||
      event.isCommentary ||
      event.isStatusNotice ||
      event.isCompactionNotice ||
      event.isFallbackNotice;
    const visible = suppressed ? undefined : visibleText(event.text);
    const hiddenSpokenText =
      visible === undefined && event.hasMedia
        ? visibleText(event.spokenText)
        : undefined;
    if (visible === undefined && hiddenSpokenText === undefined) {
      return;
    }
    const runId = nonEmptyString(event.runId ?? ctx.runId);
    const proactive = this.claimProactiveRun(sessionKey, runId);
    const entries = this.visibilityBySession.get(sessionKey) ?? [];
    entries.push({
      ...optionalField("runId", runId),
      ...optionalField("visibleText", visible),
      ...optionalField("hiddenSpokenText", hiddenSpokenText),
      ...optionalField(
        "agentId",
        nonEmptyString(event.agentId ?? proactive?.agentId)
      ),
      questionWasAbsent: proactive !== null,
      consumed: false
    });
    if (entries.length > 64) {
      entries.splice(0, entries.length - 64);
    }
    this.visibilityBySession.set(sessionKey, entries);
  }

  onMessageSent(event: MessageSentEventLike, ctx: MessageContextLike): void {
    const content = visibleText(event.content);
    const sessionKey = sourceConversationId(event, ctx);
    if (!sessionKey) {
      return;
    }
    const visibility = this.claimVisibility(
      sessionKey,
      nonEmptyString(event.runId ?? ctx.runId)
    );
    if (
      event.success !== true ||
      !content ||
      visibility?.visibleText !== content
    ) {
      return;
    }
    const pending = visibility.questionWasAbsent
      ? null
      : this.claimPending(sessionKey, nonEmptyString(ctx.replyToId));
    if (!pending && !visibility.questionWasAbsent) {
      return;
    }
    this.queue.enqueue(sessionKey, async () => {
      try {
        const state = await this.ensureReady();
        const nodeId = pending ? await pending.nodeId : undefined;
        await this.options.client.recordAnswer(
          compact({
            harness_id: state.harness_id,
            source_conversation_id: sessionKey,
            source_thread_id: sourceThreadId(event, ctx),
            node_id: nodeId,
            question_was_absent: visibility.questionWasAbsent
              ? true
              : undefined,
            text: content,
            role: "assistant",
            source_message_id: nonEmptyString(event.messageId ?? ctx.messageId),
            source_agent_id: visibility.agentId,
            source_access_agent_id: visibility.agentId,
            display_order: undefined
          })
        );
      } catch (error) {
        this.logWriteFailure("record_answer", error);
      }
    });
  }

  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: MessageContextLike
  ): Promise<unknown> {
    if (!isPartnerMemToolName(toolName)) {
      return unavailableEnvelope("partner_mem_keyword_search");
    }
    const sessionKey = nonEmptyString(ctx.sessionKey);
    if (!sessionKey) {
      return unavailableEnvelope(toolName);
    }
    try {
      const state = await this.ensureReady();
      return await this.options.client.invokeTool({
        harness_id: state.harness_id,
        source_conversation_id: sessionKey,
        ...optionalField("source_agent_id", nonEmptyString(ctx.agentId)),
        tool_name: toolName,
        arguments: args
      });
    } catch (error) {
      return unavailableEnvelope(toolName);
    }
  }

  async flush(sessionKey?: string): Promise<void> {
    await this.queue.flush(sessionKey);
  }

  close(): void {
    this.options.client.close();
  }

  private enqueueQuestion(params: {
    event: MessageReceivedEventLike;
    ctx: MessageContextLike;
    sessionKey: string;
    content: string;
  }): Promise<string> {
    const nodeId = new DeferredString();
    this.queue.enqueue(params.sessionKey, async () => {
      try {
        const state = await this.ensureReady();
        const recordedNodeId = await this.options.client.recordQuestion(
          compact({
            harness_id: state.harness_id,
            source_conversation_id: params.sessionKey,
            source_thread_id: sourceThreadId(params.event, params.ctx),
            text: params.content,
            role: "user",
            source_message_id: nonEmptyString(params.event.messageId ?? params.ctx.messageId),
            source_author_id: nonEmptyString(params.event.senderId ?? params.ctx.senderId),
            visible_at: visibleAt(params.event.timestamp),
            display_order: undefined
          })
        );
        nodeId.resolve(recordedNodeId);
        const fromSourceMessageId = nonEmptyString(
          params.event.messageId ?? params.ctx.messageId
        );
        const toSourceMessageId = nonEmptyString(
          params.event.replyToId ?? params.ctx.replyToId
        );
        if (fromSourceMessageId && toSourceMessageId) {
          try {
            await this.options.client.recordReply({
              harness_id: state.harness_id,
              from_source_message_id: fromSourceMessageId,
              to_source_message_id: toSourceMessageId
            });
          } catch (error) {
            this.logWriteFailure("record_reply", error);
          }
        }
      } catch (error) {
        nodeId.reject(errorMessage(error));
        this.logWriteFailure("record_question", error);
      }
    });
    return nodeId.promise;
  }

  private async ensureReady(): Promise<{ harness_id: string }> {
    this.start();
    if (this.readyPromise) {
      await this.readyPromise;
    }
    return await this.options.stateStore.ensure();
  }

  private rememberPending(sessionKey: string, pending: PendingQuestion): void {
    const entries = this.pendingBySession.get(sessionKey) ?? [];
    entries.push(pending);
    if (entries.length > 64) {
      entries.splice(0, entries.length - 64);
    }
    this.pendingBySession.set(sessionKey, entries);
  }

  private claimPending(sessionKey: string, replyToId: string | undefined): PendingQuestion | null {
    const entries = this.pendingBySession.get(sessionKey) ?? [];
    if (replyToId) {
      const exact = entries.find(
        (entry) => !entry.consumed && entry.sourceMessageId === replyToId
      );
      if (exact) {
        exact.consumed = true;
        return exact;
      }
      return null;
    }
    const candidates = entries.filter((entry) => !entry.consumed);
    if (candidates.length !== 1) {
      return null;
    }
    candidates[0]!.consumed = true;
    return candidates[0]!;
  }

  private claimVisibility(
    sessionKey: string,
    runId: string | undefined
  ): OutboundVisibility | null {
    const entries = this.visibilityBySession.get(sessionKey) ?? [];
    if (runId) {
      const exact = entries.filter(
        (entry) => !entry.consumed && entry.runId === runId
      );
      if (exact.length === 1) {
        exact[0]!.consumed = true;
        return exact[0]!;
      }
      return null;
    }
    const candidates = entries.filter((entry) => !entry.consumed);
    if (candidates.length !== 1) {
      return null;
    }
    candidates[0]!.consumed = true;
    return candidates[0]!;
  }

  private claimProactiveRun(
    sessionKey: string,
    runId: string | undefined
  ): ProactiveRunProof | null {
    if (!runId) {
      return null;
    }
    const entries = this.proactiveBySession.get(sessionKey) ?? [];
    const exact = entries.filter(
      (entry) => !entry.consumed && entry.runId === runId
    );
    if (exact.length !== 1) {
      return null;
    }
    exact[0]!.consumed = true;
    return exact[0]!;
  }

  private logWriteFailure(command: string, error: unknown): void {
    const message = errorMessage(error);
    this.logger.warn(`Partner-Mem OpenClaw ${command} failed: ${message}`);
  }
}

class DeferredString {
  readonly promise: Promise<string>;
  private resolveValue: ((value: string) => void) | null = null;
  private rejectValue: ((reason: Error) => void) | null = null;

  constructor() {
    this.promise = new Promise<string>((resolve, reject) => {
      this.resolveValue = resolve;
      this.rejectValue = reject;
    });
  }

  resolve(value: string): void {
    this.resolveValue?.(value);
  }

  reject(message: string): void {
    this.rejectValue?.(new RuntimeTransportError(message));
  }
}

function sourceConversationId(
  event: { sessionKey?: string },
  ctx: MessageContextLike
): string | undefined {
  return nonEmptyString(ctx.sessionKey ?? event.sessionKey);
}

function sourceThreadId(
  event: { threadId?: string | number } | undefined,
  ctx: MessageContextLike
): string | undefined {
  const value = event?.threadId ?? ctx.threadId;
  return typeof value === "number" ? String(value) : nonEmptyString(value);
}

function visibleText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim().length > 0 ? value : undefined;
}

function visibleAt(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function optionalField<const K extends string, V>(
  key: K,
  value: V | undefined
): undefined extends V ? Partial<Record<K, V>> : Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Partner-Mem unavailable";
}
