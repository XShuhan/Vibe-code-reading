import * as vscode from "vscode";

import type { ModelConfig } from "@code-vibe/shared";

type RequiredThreadModelField = "baseUrl" | "apiKey" | "model";

export type ThreadModelReadiness =
  | {
      isReady: true;
    }
  | {
      isReady: false;
      reason: "mock-provider" | "missing-fields";
      missingFields: RequiredThreadModelField[];
    };

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "mock",
  baseUrl: "https://api.moonshot.cn/v1",
  apiKey: "",
  model: "kimi-k2-0905-preview",
  temperature: 0.1,
  maxTokens: 8192
};

export function getModelConfig(): ModelConfig {
  const config = vscode.workspace.getConfiguration("vibe.model");

  return {
    provider: config.get<ModelConfig["provider"]>("provider", DEFAULT_MODEL_CONFIG.provider),
    baseUrl: config.get<string>("baseUrl", DEFAULT_MODEL_CONFIG.baseUrl),
    apiKey: config.get<string>("apiKey", DEFAULT_MODEL_CONFIG.apiKey),
    model: config.get<string>("model", DEFAULT_MODEL_CONFIG.model),
    temperature: config.get<number>("temperature", DEFAULT_MODEL_CONFIG.temperature),
    maxTokens: config.get<number>("maxTokens", DEFAULT_MODEL_CONFIG.maxTokens)
  };
}

export function evaluateThreadModelReadiness(modelConfig: ModelConfig): ThreadModelReadiness {
  if (modelConfig.provider === "mock") {
    return {
      isReady: false,
      reason: "mock-provider",
      missingFields: []
    };
  }

  const missingFields = (["baseUrl", "apiKey", "model"] as const).filter((field) => {
    const value = modelConfig[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingFields.length > 0) {
    return {
      isReady: false,
      reason: "missing-fields",
      missingFields
    };
  }

  return { isReady: true };
}

export function assertModelConfigured(modelConfig: ModelConfig): void {
  if (modelConfig.provider === "mock") {
    return;
  }

  if (!modelConfig.baseUrl || !modelConfig.apiKey || !modelConfig.model) {
    throw new Error(
      [
        "AI is not configured.",
        "For Moonshot Open Platform: set vibe.model.baseUrl=https://api.moonshot.cn/v1 and a valid Moonshot model id.",
        "For Kimi Code direct access: set vibe.model.baseUrl=https://api.kimi.com/coding/v1 and vibe.model.model=kimi-for-coding.",
        "For OpenClaw gateway: set vibe.model.baseUrl=http://127.0.0.1:<port>/v1 and vibe.model.model=openclaw:<agentId>."
      ].join(" ")
    );
  }
}
