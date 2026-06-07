import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "@photostructure/sqlite";
import type { OpenClawLogger, OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createPartnerMemCoreConfig, type PartnerMemOpenClawConfig } from "./config.js";
import { ContextAssembler } from "../../src/context/context-assembler.js";
import { ExtractorService } from "../../src/extraction/extractor-service.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { GraphStore } from "../../src/storage/graph-store.js";
import { initializeSchema, type SqliteDatabase } from "../../src/storage/schema.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createOpenClawExtractorModelClient } from "./model-client.js";

export interface PartnerMemOpenClawRuntime {
  config: PartnerMemOpenClawConfig;
  logger: OpenClawLogger;
  ingest: RawIngestService;
  facade: ToolFacade;
  contextAssembler: ContextAssembler;
  nextTurnIndex(sessionId: string): number;
  hasSeenCapture(key: string): boolean;
  markCaptureSeen(key: string): void;
  enqueueExtraction(rawNodeIds: string[]): void;
  drainExtractionQueueForTests(): Promise<void>;
  stop(): void;
}

export function createPartnerMemOpenClawRuntime(
  api: OpenClawPluginApi,
  config: PartnerMemOpenClawConfig
): PartnerMemOpenClawRuntime {
  const logger = api.logger ?? {};
  const resolvedDbPath = api.resolvePath(config.dbPath);
  mkdirSync(dirname(resolvedDbPath), { recursive: true });

  const db = new DatabaseSync(resolvedDbPath) as SqliteDatabase & {
    close?: () => void;
  };
  initializeSchema(db);

  const store = new GraphStore(db);
  const ingest = new RawIngestService(store);
  const facade = new ToolFacade(store);
  const contextAssembler = new ContextAssembler(facade, createPartnerMemCoreConfig(config));
  const extractor = new ExtractorService(store, createOpenClawExtractorModelClient(api, config));
  const extractionQueue: string[] = [];
  const turnIndexes = new Map<string, number>();
  const seenCaptureKeys = new Set<string>();
  let draining: Promise<void> | undefined;
  let stopped = false;

  async function drainExtractionQueue(): Promise<void> {
    while (!stopped && extractionQueue.length > 0) {
      const rawNodeId = extractionQueue.shift();
      if (!rawNodeId) continue;

      try {
        const result = await extractor.extractRawNodes([rawNodeId]);
        if (result.rejected_items.length > 0) {
          logger.warn?.("Partner-Mem typed graph extraction skipped items", {
            raw_node_id: rawNodeId,
            rejected_count: result.rejected_items.length,
            reasons: result.rejected_items.map((item) => item.reason)
          });
        }
        if (result.accepted_items.length > 0) {
          logger.debug?.("Partner-Mem typed graph extraction accepted items", {
            raw_node_id: rawNodeId,
            accepted_count: result.accepted_items.length
          });
        }
      } catch (error) {
        logger.warn?.("Partner-Mem typed graph extraction skipped after failure", {
          raw_node_id: rawNodeId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  function scheduleExtractionDrain(): void {
    if (draining || stopped || extractionQueue.length === 0) return;
    draining = Promise.resolve()
      .then(drainExtractionQueue)
      .catch((error: unknown) => {
        logger.warn?.("Partner-Mem typed graph extraction queue failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        draining = undefined;
        if (!stopped && extractionQueue.length > 0) scheduleExtractionDrain();
      });
  }

  return {
    config,
    logger,
    ingest,
    facade,
    contextAssembler,
    nextTurnIndex(sessionId: string) {
      const next = turnIndexes.get(sessionId) ?? 0;
      turnIndexes.set(sessionId, next + 1);
      return next;
    },
    hasSeenCapture(key: string) {
      return seenCaptureKeys.has(key);
    },
    markCaptureSeen(key: string) {
      seenCaptureKeys.add(key);
    },
    enqueueExtraction(rawNodeIds: string[]) {
      if (!config.extractor.enabled || stopped) return;
      for (const rawNodeId of rawNodeIds) {
        if (extractionQueue.length >= config.extractor.queueMaxItems) {
          logger.warn?.("Partner-Mem extraction queue is full; raw node skipped", { raw_node_id: rawNodeId });
          continue;
        }
        extractionQueue.push(rawNodeId);
      }
      scheduleExtractionDrain();
    },
    async drainExtractionQueueForTests() {
      if (!config.extractor.enabled || stopped) return;
      if (draining) await draining;
      if (extractionQueue.length > 0) {
        await drainExtractionQueue();
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      extractionQueue.length = 0;
      db.close?.();
    }
  };
}
