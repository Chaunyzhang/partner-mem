import { getDefaultConfig, type PartnerMemConfig } from "../../src/config/default-config.js";

export interface PartnerMemOpenClawConfig {
  dbPath: string;
  autoCapture: boolean;
  autoRecall: boolean;
  contextBudgetTokens: number;
  recallLimit: number;
  captureMaxCharsPerTurn: number;
  captureMaxCompleteMessages: number;
  hookTimeoutMs: number;
  extractor: PartnerMemOpenClawExtractorConfig;
}

export interface PartnerMemOpenClawExtractorConfig {
  enabled: boolean;
  provider?: string;
  model?: string;
  allowedModels: string[];
  timeoutMs: number;
  maxTokens: number;
  queueMaxItems: number;
  onFailure: "skip";
}

export const DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG: PartnerMemOpenClawConfig = {
  dbPath: "~/.openclaw/partner-mem/partner-mem.db",
  autoCapture: true,
  autoRecall: true,
  contextBudgetTokens: 1200,
  recallLimit: 4,
  captureMaxCharsPerTurn: 25000,
  captureMaxCompleteMessages: 10,
  hookTimeoutMs: 12000,
  extractor: {
    enabled: false,
    allowedModels: [],
    timeoutMs: 30000,
    maxTokens: 1200,
    queueMaxItems: 1000,
    onFailure: "skip"
  }
};

const INTEGER_RANGES = {
  contextBudgetTokens: { min: 1, max: 20000 },
  recallLimit: { min: 1, max: 50 },
  captureMaxCharsPerTurn: { min: 1000, max: 200000 },
  captureMaxCompleteMessages: { min: 1, max: 100 },
  hookTimeoutMs: { min: 100, max: 14000 }
} as const satisfies Record<keyof Omit<PartnerMemOpenClawConfig, "dbPath" | "autoCapture" | "autoRecall" | "extractor">, {
  min: number;
  max: number;
}>;

const EXTRACTOR_INTEGER_RANGES = {
  timeoutMs: { min: 1000, max: 120000 },
  maxTokens: { min: 128, max: 8000 },
  queueMaxItems: { min: 1, max: 10000 }
} as const;

export function readPartnerMemOpenClawConfig(raw: unknown): PartnerMemOpenClawConfig {
  if (raw == null) return { ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG };
  if (!isRecord(raw)) {
    throw new TypeError("Partner-Mem OpenClaw config must be an object");
  }

  const config = { ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG };

  if ("dbPath" in raw) {
    if (typeof raw.dbPath !== "string" || raw.dbPath.trim().length === 0) {
      throw new TypeError("dbPath must be a non-empty string");
    }
    config.dbPath = raw.dbPath;
  }

  for (const key of ["autoCapture", "autoRecall"] as const) {
    if (key in raw) {
      if (typeof raw[key] !== "boolean") {
        throw new TypeError(`${key} must be a boolean`);
      }
      config[key] = raw[key];
    }
  }

  for (const key of Object.keys(INTEGER_RANGES) as Array<keyof typeof INTEGER_RANGES>) {
    if (key in raw) {
      config[key] = readIntegerInRange(key, raw[key], INTEGER_RANGES[key]);
    }
  }

  if ("extractor" in raw) {
    config.extractor = readExtractorConfig(raw.extractor);
  }

  return config;
}

export function createPartnerMemCoreConfig(config: PartnerMemOpenClawConfig): PartnerMemConfig {
  const defaults = getDefaultConfig();

  return {
    context: {
      ...defaults.context,
      maxTokens: config.contextBudgetTokens,
      recentMessages: config.recallLimit,
      autoRecallEnabled: true,
      evidenceMaxItems: config.recallLimit
    },
    summary: {
      ...defaults.summary,
      autoBuildEnabled: false,
      mode: "manual",
      provider: "none"
    }
  };
}

function readIntegerInRange(
  key: string,
  value: unknown,
  range: { min: number; max: number }
): number {
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new TypeError(`${key} must be an integer`);
  }
  if (value < range.min || value > range.max) {
    throw new TypeError(`${key} must be between ${range.min} and ${range.max}`);
  }
  return value;
}

function readExtractorConfig(raw: unknown): PartnerMemOpenClawExtractorConfig {
  if (raw == null) return { ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.extractor };
  if (!isRecord(raw)) {
    throw new TypeError("extractor must be an object");
  }

  const config: PartnerMemOpenClawExtractorConfig = {
    ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.extractor,
    allowedModels: [...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.extractor.allowedModels]
  };

  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") {
      throw new TypeError("extractor.enabled must be a boolean");
    }
    config.enabled = raw.enabled;
  }

  for (const key of ["provider", "model"] as const) {
    if (key in raw) {
      if (typeof raw[key] !== "string" || raw[key].trim().length === 0) {
        throw new TypeError(`extractor.${key} must be a non-empty string`);
      }
      config[key] = raw[key].trim();
    }
  }

  if ("allowedModels" in raw) {
    if (!Array.isArray(raw.allowedModels)) {
      throw new TypeError("extractor.allowedModels must be an array");
    }
    config.allowedModels = raw.allowedModels.map((modelKey, index) => {
      if (typeof modelKey !== "string" || !/^[^/\s]+\/[^/\s]+$/u.test(modelKey.trim())) {
        throw new TypeError(`extractor.allowedModels[${index}] must be provider/model`);
      }
      return modelKey.trim();
    });
  }

  for (const key of Object.keys(EXTRACTOR_INTEGER_RANGES) as Array<keyof typeof EXTRACTOR_INTEGER_RANGES>) {
    if (key in raw) {
      config[key] = readIntegerInRange(`extractor.${key}`, raw[key], EXTRACTOR_INTEGER_RANGES[key]);
    }
  }

  if ("onFailure" in raw) {
    if (raw.onFailure !== "skip") {
      throw new TypeError('extractor.onFailure must be "skip"');
    }
    config.onFailure = "skip";
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
