import fs from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { ModelConfig } from "@code-vibe/shared";

type RequiredThreadModelField = "baseUrl" | "apiKey" | "model";

export type WorkspaceLanguage = "zh-CN" | "en";

export type ThreadModelReadiness =
  | {
      isReady: true;
    }
  | {
      isReady: false;
      reason: "missing-fields";
      missingFields: RequiredThreadModelField[];
    };

interface WorkspacePreferences {
  language: WorkspaceLanguage;
  modelConfig: ModelConfig;
}

interface WorkspaceConfigFile {
  language?: WorkspaceLanguage;
  provider?: ModelConfig["provider"];
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.1,
  maxTokens: 8192
};

const DEFAULT_LANGUAGE = "en";
const LOCAL_CONFIG_DIR_NAME = ".code-vibe";
const LOCAL_CONFIG_FILE_NAME = "config.json";
const CONFIGURE_API_ACTION = "Configure";
const LATER_ACTION = "Later";

const STORED_PREFERENCES_STATE_KEYS = {
  language: "workspacePreferences.language",
  provider: "workspacePreferences.modelConfig.provider",
  baseUrl: "workspacePreferences.modelConfig.baseUrl",
  model: "workspacePreferences.modelConfig.model",
  temperature: "workspacePreferences.modelConfig.temperature",
  maxTokens: "workspacePreferences.modelConfig.maxTokens"
} as const;

const STORED_PREFERENCES_SECRET_KEY = "workspacePreferences.modelConfig.apiKey";

const LEGACY_MODEL_CONFIG_STATE_KEYS = {
  provider: "modelConfig.provider",
  baseUrl: "modelConfig.baseUrl",
  model: "modelConfig.model",
  temperature: "modelConfig.temperature",
  maxTokens: "modelConfig.maxTokens"
} as const;

const LEGACY_MODEL_CONFIG_SECRET_KEY = "modelConfig.apiKey";

let cachedWorkspacePreferences: WorkspacePreferences | null = null;
const workspacePreferencesEmitter = new vscode.EventEmitter<WorkspacePreferences>();

export const onDidChangeWorkspacePreferences = workspacePreferencesEmitter.event;

export async function getModelConfig(context: vscode.ExtensionContext): Promise<ModelConfig> {
  return (await getWorkspacePreferences(context)).modelConfig;
}

export async function getWorkspaceLanguage(
  context: vscode.ExtensionContext
): Promise<WorkspaceLanguage> {
  return (await getWorkspacePreferences(context)).language;
}

export function getCachedWorkspaceLanguage(): WorkspaceLanguage {
  return cachedWorkspacePreferences?.language ?? inferDefaultLanguage();
}

export async function promptForInitialModelSetup(
  context: vscode.ExtensionContext
): Promise<ModelConfig | undefined> {
  const preferences = await getWorkspacePreferences(context);
  if (evaluateThreadModelReadiness(preferences.modelConfig).isReady) {
    return preferences.modelConfig;
  }

  const selection = await vscode.window.showInformationMessage(
    "Before using Code Vibe Reading, choose your language and configure your API.",
    { modal: true },
    CONFIGURE_API_ACTION,
    LATER_ACTION
  );
  if (selection !== CONFIGURE_API_ACTION) {
    return undefined;
  }

  return configureWorkspace(context);
}

export async function ensureModelConfigured(
  context: vscode.ExtensionContext,
  reason: "ask" | "command"
): Promise<ModelConfig | undefined> {
  const preferences = await getWorkspacePreferences(context);
  const readiness = evaluateThreadModelReadiness(preferences.modelConfig);
  if (readiness.isReady) {
    return preferences.modelConfig;
  }

  const selection = await vscode.window.showWarningMessage(
    buildThreadModelReminderMessage(readiness, reason),
    CONFIGURE_API_ACTION
  );
  if (selection !== CONFIGURE_API_ACTION) {
    return undefined;
  }

  return configureWorkspace(context);
}

export async function openApiConfiguration(context: vscode.ExtensionContext): Promise<void> {
  const config = await configureWorkspace(context);
  if (!config) {
    return;
  }

  void vscode.commands.executeCommand(COMMANDS.testModelConnection);
}

export function evaluateThreadModelReadiness(modelConfig: ModelConfig): ThreadModelReadiness {
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
        "Set a valid base URL, API key, and model in Code Vibe Reading.",
        "For Kimi Code direct access, use https://api.kimi.com/coding/v1 with model kimi-for-coding.",
        "For Moonshot Open Platform, use https://api.moonshot.cn/v1 with the exact model enabled in your account."
      ].join(" ")
    );
  }
}

async function getWorkspacePreferences(
  context: vscode.ExtensionContext
): Promise<WorkspacePreferences> {
  if (cachedWorkspacePreferences) {
    return cachedWorkspacePreferences;
  }

  const storedPreferences = await getStoredPreferences(context);
  if (storedPreferences) {
    cachedWorkspacePreferences = storedPreferences;
    return storedPreferences;
  }

  const localPreferences = await getLocalWorkspacePreferences();
  if (localPreferences) {
    await persistWorkspacePreferences(context, localPreferences);
    return localPreferences;
  }

  const legacyStored = await getLegacyStoredModelConfig(context);
  if (legacyStored) {
    const migrated = {
      language: inferDefaultLanguage(),
      modelConfig: legacyStored
    } satisfies WorkspacePreferences;
    await persistWorkspacePreferences(context, migrated);
    return migrated;
  }

  const legacySettings = getLegacySettingsModelConfig();
  if (evaluateThreadModelReadiness(legacySettings).isReady) {
    const migrated = {
      language: inferDefaultLanguage(),
      modelConfig: legacySettings
    } satisfies WorkspacePreferences;
    await persistWorkspacePreferences(context, migrated);
    return migrated;
  }

  const defaults = {
    language: inferDefaultLanguage(),
    modelConfig: { ...DEFAULT_MODEL_CONFIG }
  } satisfies WorkspacePreferences;
  cachedWorkspacePreferences = defaults;
  return defaults;
}

async function configureWorkspace(
  context: vscode.ExtensionContext
): Promise<ModelConfig | undefined> {
  const currentPreferences = await getWorkspacePreferences(context);
  const language = await promptForLanguage(currentPreferences.language);
  if (!language) {
    return undefined;
  }

  const baseUrl = await vscode.window.showInputBox({
    title: localizeTitle(language, "Configure Code Vibe Reading", "配置 Code Vibe Reading"),
    prompt: localizeTitle(
      language,
      "Enter the base URL for your OpenAI-compatible API.",
      "请输入 OpenAI 兼容 API 的 Base URL。"
    ),
    placeHolder: "https://api.kimi.com/coding/v1",
    value: currentPreferences.modelConfig.baseUrl,
    ignoreFocusOut: true,
    validateInput: (value) => validateBaseUrl(value, language)
  });
  if (baseUrl === undefined) {
    return undefined;
  }

  const hasStoredApiKey = Boolean(currentPreferences.modelConfig.apiKey.trim());
  const apiKey = await vscode.window.showInputBox({
    title: localizeTitle(language, "Configure Code Vibe Reading", "配置 Code Vibe Reading"),
    prompt: hasStoredApiKey
      ? localizeTitle(
          language,
          "Enter a new API key, or leave blank to keep the current key.",
          "输入新的 API Key，或留空以保留当前 Key。"
        )
      : localizeTitle(language, "Enter your API key.", "请输入你的 API Key。"),
    placeHolder: hasStoredApiKey ? localizeTitle(language, "Leave blank to keep current key", "留空表示保留当前 Key") : "sk-...",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => validateApiKey(value, hasStoredApiKey, language),
    value: ""
  });
  if (apiKey === undefined) {
    return undefined;
  }

  const model = await vscode.window.showInputBox({
    title: localizeTitle(language, "Configure Code Vibe Reading", "配置 Code Vibe Reading"),
    prompt: localizeTitle(
      language,
      "Enter the model name to use for grounded answers.",
      "请输入用于回答的模型名称。"
    ),
    placeHolder: "kimi-for-coding",
    value: currentPreferences.modelConfig.model,
    ignoreFocusOut: true,
    validateInput: (value) => validateRequiredText(value, language === "en" ? "Model" : "模型")
  });
  if (model === undefined) {
    return undefined;
  }

  const nextPreferences: WorkspacePreferences = {
    language,
    modelConfig: {
      provider: "openai-compatible",
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || currentPreferences.modelConfig.apiKey,
      model: model.trim(),
      temperature: currentPreferences.modelConfig.temperature || DEFAULT_MODEL_CONFIG.temperature,
      maxTokens: currentPreferences.modelConfig.maxTokens || DEFAULT_MODEL_CONFIG.maxTokens
    }
  };

  await persistWorkspacePreferences(context, nextPreferences);
  vscode.window.showInformationMessage(
    localizeTitle(
      language,
      "Configuration saved. You can change it later with “Vibe: Configure API”.",
      "配置已保存。后续可通过 “Vibe: Configure API” 修改。"
    )
  );
  return nextPreferences.modelConfig;
}

async function promptForLanguage(
  currentLanguage: WorkspaceLanguage
): Promise<WorkspaceLanguage | undefined> {
  const selection = await vscode.window.showQuickPick(
    [
      {
        label: "中文",
        description: "Project Overview 和提示文案使用中文",
        value: "zh-CN" as const
      },
      {
        label: "English",
        description: "Use English for Project Overview and prompts",
        value: "en" as const
      }
    ],
    {
      title: currentLanguage === "zh-CN" ? "选择语言" : "Choose Language",
      placeHolder: currentLanguage === "zh-CN" ? "选择中文或英文" : "Choose Chinese or English",
      ignoreFocusOut: true
    }
  );

  return selection?.value;
}

async function getLocalWorkspacePreferences(): Promise<WorkspacePreferences | undefined> {
  const configFilePath = getLocalConfigFilePath();
  if (!configFilePath) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    const parsed = JSON.parse(raw) as WorkspaceConfigFile;
    return {
      language: normalizeLanguage(parsed.language),
      modelConfig: {
        provider: "openai-compatible",
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
        temperature:
          typeof parsed.temperature === "number" ? parsed.temperature : DEFAULT_MODEL_CONFIG.temperature,
        maxTokens: typeof parsed.maxTokens === "number" ? parsed.maxTokens : DEFAULT_MODEL_CONFIG.maxTokens
      }
    };
  } catch {
    return undefined;
  }
}

async function getStoredPreferences(
  context: vscode.ExtensionContext
): Promise<WorkspacePreferences | undefined> {
  const storedLanguage = context.globalState.get<WorkspaceLanguage>(STORED_PREFERENCES_STATE_KEYS.language);
  const provider = context.globalState.get<ModelConfig["provider"]>(STORED_PREFERENCES_STATE_KEYS.provider);
  const baseUrl = context.globalState.get<string>(STORED_PREFERENCES_STATE_KEYS.baseUrl);
  const model = context.globalState.get<string>(STORED_PREFERENCES_STATE_KEYS.model);
  const temperature = context.globalState.get<number>(STORED_PREFERENCES_STATE_KEYS.temperature);
  const maxTokens = context.globalState.get<number>(STORED_PREFERENCES_STATE_KEYS.maxTokens);
  const apiKey = await context.secrets.get(STORED_PREFERENCES_SECRET_KEY);

  const hasStoredValue =
    typeof storedLanguage === "string" ||
    typeof provider === "string" ||
    typeof baseUrl === "string" ||
    typeof model === "string" ||
    typeof apiKey === "string" ||
    typeof temperature === "number" ||
    typeof maxTokens === "number";

  if (!hasStoredValue) {
    return undefined;
  }

  return {
    language: normalizeLanguage(storedLanguage),
    modelConfig: {
      provider: provider ?? "openai-compatible",
      baseUrl: baseUrl ?? "",
      apiKey: apiKey ?? "",
      model: model ?? "",
      temperature: temperature ?? DEFAULT_MODEL_CONFIG.temperature,
      maxTokens: maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens
    }
  };
}

async function persistWorkspacePreferences(
  context: vscode.ExtensionContext,
  preferences: WorkspacePreferences
): Promise<void> {
  await Promise.all([
    context.globalState.update(STORED_PREFERENCES_STATE_KEYS.language, preferences.language),
    context.globalState.update(STORED_PREFERENCES_STATE_KEYS.provider, "openai-compatible"),
    context.globalState.update(STORED_PREFERENCES_STATE_KEYS.baseUrl, preferences.modelConfig.baseUrl),
    context.globalState.update(STORED_PREFERENCES_STATE_KEYS.model, preferences.modelConfig.model),
    context.globalState.update(
      STORED_PREFERENCES_STATE_KEYS.temperature,
      preferences.modelConfig.temperature ?? DEFAULT_MODEL_CONFIG.temperature
    ),
    context.globalState.update(
      STORED_PREFERENCES_STATE_KEYS.maxTokens,
      preferences.modelConfig.maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens
    ),
    preferences.modelConfig.apiKey.trim()
      ? context.secrets.store(STORED_PREFERENCES_SECRET_KEY, preferences.modelConfig.apiKey)
      : context.secrets.delete(STORED_PREFERENCES_SECRET_KEY)
  ]);

  cachedWorkspacePreferences = preferences;
  workspacePreferencesEmitter.fire(preferences);
  await Promise.all([
    clearLegacyStoredModelConfig(context),
    clearLegacyWorkspaceSettings(),
    deleteLocalWorkspaceConfig()
  ]);
}

function getLegacySettingsModelConfig(): ModelConfig {
  const config = vscode.workspace.getConfiguration("vibe.model");
  return {
    provider: "openai-compatible",
    baseUrl: config.get<string>("baseUrl", DEFAULT_MODEL_CONFIG.baseUrl),
    apiKey: config.get<string>("apiKey", DEFAULT_MODEL_CONFIG.apiKey),
    model: config.get<string>("model", DEFAULT_MODEL_CONFIG.model),
    temperature: config.get<number>("temperature", DEFAULT_MODEL_CONFIG.temperature),
    maxTokens: config.get<number>("maxTokens", DEFAULT_MODEL_CONFIG.maxTokens)
  };
}

async function getLegacyStoredModelConfig(
  context: vscode.ExtensionContext
): Promise<ModelConfig | undefined> {
  const provider = context.globalState.get<ModelConfig["provider"]>(LEGACY_MODEL_CONFIG_STATE_KEYS.provider);
  const baseUrl = context.globalState.get<string>(LEGACY_MODEL_CONFIG_STATE_KEYS.baseUrl);
  const model = context.globalState.get<string>(LEGACY_MODEL_CONFIG_STATE_KEYS.model);
  const temperature = context.globalState.get<number>(LEGACY_MODEL_CONFIG_STATE_KEYS.temperature);
  const maxTokens = context.globalState.get<number>(LEGACY_MODEL_CONFIG_STATE_KEYS.maxTokens);
  const apiKey = await context.secrets.get(LEGACY_MODEL_CONFIG_SECRET_KEY);

  if (!provider || !baseUrl || !model || !apiKey) {
    return undefined;
  }

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    temperature: temperature ?? DEFAULT_MODEL_CONFIG.temperature,
    maxTokens: maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens
  };
}

async function clearLegacyStoredModelConfig(context: vscode.ExtensionContext): Promise<void> {
  await Promise.all([
    context.globalState.update(LEGACY_MODEL_CONFIG_STATE_KEYS.provider, undefined),
    context.globalState.update(LEGACY_MODEL_CONFIG_STATE_KEYS.baseUrl, undefined),
    context.globalState.update(LEGACY_MODEL_CONFIG_STATE_KEYS.model, undefined),
    context.globalState.update(LEGACY_MODEL_CONFIG_STATE_KEYS.temperature, undefined),
    context.globalState.update(LEGACY_MODEL_CONFIG_STATE_KEYS.maxTokens, undefined),
    context.secrets.delete(LEGACY_MODEL_CONFIG_SECRET_KEY)
  ]);
}

async function clearLegacyWorkspaceSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration("vibe.model");
  await Promise.all(
    ["provider", "baseUrl", "apiKey", "model", "temperature", "maxTokens"].map((key) =>
      config.update(key, undefined, vscode.ConfigurationTarget.Workspace)
    )
  );
}

function getLocalConfigFilePath(): string | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return undefined;
  }

  return path.join(workspaceRoot, LOCAL_CONFIG_DIR_NAME, LOCAL_CONFIG_FILE_NAME);
}

async function deleteLocalWorkspaceConfig(): Promise<void> {
  const configFilePath = getLocalConfigFilePath();
  if (!configFilePath) {
    return;
  }

  try {
    await fs.rm(configFilePath, { force: true });
  } catch {
    // Ignore cleanup errors and continue using global preferences.
  }
}

function buildThreadModelReminderMessage(
  readiness: Exclude<ThreadModelReadiness, { isReady: true }>,
  reason: "ask" | "command"
): string {
  const missing = readiness.missingFields.join(", ");
  return [
    reason === "ask"
      ? "AI is not configured yet. Configure Code Vibe Reading before asking questions."
      : "AI is not configured yet. Configure Code Vibe Reading before testing the connection.",
    `Missing: ${missing}.`
  ].join(" ");
}

function inferDefaultLanguage(): WorkspaceLanguage {
  const locale = vscode.env.language.toLowerCase();
  return locale.startsWith("zh") ? "zh-CN" : DEFAULT_LANGUAGE;
}

function normalizeLanguage(value: WorkspaceConfigFile["language"]): WorkspaceLanguage {
  return value === "zh-CN" || value === "en" ? value : inferDefaultLanguage();
}

function localizeTitle(language: WorkspaceLanguage, english: string, chinese: string): string {
  return language === "zh-CN" ? chinese : english;
}

function validateBaseUrl(value: string, language: WorkspaceLanguage): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return language === "zh-CN" ? "Base URL 不能为空。" : "Base URL is required.";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return language === "zh-CN"
        ? "Base URL 必须以 http:// 或 https:// 开头。"
        : "Base URL must start with http:// or https://";
    }
  } catch {
    return language === "zh-CN" ? "请输入合法的 URL。" : "Enter a valid URL.";
  }

  return undefined;
}

function validateApiKey(
  value: string,
  allowEmpty: boolean,
  language: WorkspaceLanguage
): string | undefined {
  if (allowEmpty && value.trim().length === 0) {
    return undefined;
  }

  return validateRequiredText(value, language === "zh-CN" ? "API Key" : "API key");
}

function validateRequiredText(value: string, label: string): string | undefined {
  if (!value.trim()) {
    return `${label} is required.`;
  }

  return undefined;
}
