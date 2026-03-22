import fs from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { createModelAdapter } from "@code-vibe/model-gateway";
import type { WorkspaceIndex } from "@code-vibe/shared";
import { nowIso } from "@code-vibe/shared";

import {
  assertModelConfigured,
  getCachedWorkspaceLanguage,
  getModelConfig,
  getWorkspaceLanguage,
  type WorkspaceLanguage
} from "../config/settings";
import {
  buildProjectOverviewPrompt,
  normalizeGeneratedProjectOverview,
  sanitizeGeneratedProjectOverview
} from "../agent/projectOverviewOrchestrator";
import { generateProjectSummary } from "./indexService";
import type { IndexService, ProjectSummary } from "./indexService";

const PROJECT_OVERVIEW_FILE_NAME = "project-overview.json";
const PROJECT_OVERVIEW_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectGoal",
    "implementationNarrative",
    "startupEntry",
    "startupFlow",
    "keyModules",
    "executionFlow",
    "flowDiagram",
    "uncertainty"
  ],
  properties: {
    projectGoal: { type: "string" },
    implementationNarrative: { type: "string" },
    startupEntry: {
      type: "object",
      additionalProperties: false,
      required: ["file", "summary", "logic"],
      properties: {
        file: { type: "string" },
        summary: { type: "string" },
        logic: { type: "string" }
      }
    },
    startupFlow: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "file", "summary", "details"],
        properties: {
          title: { type: "string" },
          file: { type: "string" },
          summary: { type: "string" },
          details: { type: "string" }
        }
      }
    },
    keyModules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "file", "responsibility"],
        properties: {
          name: { type: "string" },
          file: { type: "string" },
          responsibility: { type: "string" }
        }
      }
    },
    executionFlow: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "file", "summary", "next"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          file: { type: "string" },
          summary: { type: "string" },
          next: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    },
    flowDiagram: { type: "string" },
    uncertainty: { type: "string" }
  }
};

export type ProjectOverviewStatus = "idle" | "generating" | "ready" | "stale" | "error";

export interface ProjectOverviewStartupStep {
  title: string;
  file: string;
  summary: string;
  details: string;
}

export interface ProjectOverviewKeyModule {
  name: string;
  file: string;
  responsibility: string;
}

export interface ProjectOverviewFlowNode {
  id: string;
  title: string;
  file: string;
  summary: string;
  next: string[];
}

export interface GeneratedProjectOverview {
  schemaVersion: 1;
  workspaceId: string;
  sourceRevision: string;
  generatedAt: string;
  language: WorkspaceLanguage;
  projectGoal: string;
  implementationNarrative: string;
  startupEntry: {
    file: string;
    summary: string;
    logic: string;
  };
  startupFlow: ProjectOverviewStartupStep[];
  keyModules: ProjectOverviewKeyModule[];
  executionFlow: ProjectOverviewFlowNode[];
  flowDiagram: string;
  uncertainty: string;
  sourceFiles: string[];
}

export interface ProjectOverviewFileDossier {
  path: string;
  reason: string;
  symbolOutline: string;
  excerpt: string;
}

export interface ProjectOverviewDossier {
  primaryLanguage: string;
  coreDirectories: string[];
  entryCandidates: string[];
  coreModules: string[];
  topFunctions: string[];
  readme: string;
  packageManifest: string;
  fileDossiers: ProjectOverviewFileDossier[];
}

export class ProjectOverviewService {
  private overview: GeneratedProjectOverview | null = null;
  private status: ProjectOverviewStatus = "idle";
  private lastError = "";
  private readonly emitter = new vscode.EventEmitter<void>();
  private refreshInFlight: Promise<GeneratedProjectOverview | null> | null = null;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly indexService: IndexService,
    private readonly storageRoot: string,
    private readonly output: vscode.OutputChannel
  ) {
    this.indexService.onDidChange(() => {
      this.syncStatusWithIndex();
      this.emitter.fire();
    });
  }

  async initialize(): Promise<void> {
    this.overview = await this.loadOverviewFromDisk();
    this.syncStatusWithIndex();
    this.emitter.fire();
  }

  getOverview(): GeneratedProjectOverview | null {
    return this.overview;
  }

  getStatus(): ProjectOverviewStatus {
    return this.status;
  }

  getLastError(): string {
    return this.lastError;
  }

  async refresh(reason: string, index?: WorkspaceIndex): Promise<GeneratedProjectOverview | null> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.status = "generating";
    this.lastError = "";
    this.emitter.fire();

    this.refreshInFlight = this.refreshInternal(reason, index)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        this.status = this.overview ? "stale" : "error";
        this.output.appendLine(`[overview] error reason=${reason} message=${message}`);
        this.emitter.fire();
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private async refreshInternal(
    reason: string,
    explicitIndex?: WorkspaceIndex
  ): Promise<GeneratedProjectOverview | null> {
    const modelConfig = await getModelConfig(this.context);
    assertModelConfigured(modelConfig);

    const index = explicitIndex ?? (await this.indexService.ensureIndex());
    const language = await getWorkspaceLanguage(this.context);
    const dossier = await buildProjectOverviewDossier(index, this.indexService.getRootPath());
    const { systemInstruction, userPrompt } = buildProjectOverviewPrompt(language, dossier, index, {
      modelName: modelConfig.model
    });
    const adapter = createModelAdapter(modelConfig);

    this.output.appendLine(
      `[overview] start reason=${reason} model=${modelConfig.model} files=${dossier.fileDossiers.length} revision=${index.snapshot.revision}`
    );

    const response = await adapter.completeChat({
      model: modelConfig.model,
      temperature: 0,
      maxTokens: Math.min(modelConfig.maxTokens || 4096, 4096),
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "project_overview_response",
          schema: PROJECT_OVERVIEW_RESPONSE_SCHEMA,
          strict: true
        }
      },
      messages: [
        {
          role: "system",
          content: systemInstruction
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    logOverviewRawResponse(this.output, "first_pass_raw_response", response.content);
    let parsed = safeParseJsonObject(response.content);
    if (isGlm5ModelName(modelConfig.model) && shouldRunOverviewRewritePass(parsed)) {
      this.output.appendLine("[overview] glm5_rewrite_pass starting");
      const rewritten = await adapter.completeChat({
        model: modelConfig.model,
        temperature: 0,
        maxTokens: Math.min(modelConfig.maxTokens || 4096, 4096),
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "project_overview_rewrite_response",
            schema: PROJECT_OVERVIEW_RESPONSE_SCHEMA,
            strict: true
          }
        },
        messages: [
          {
            role: "system",
            content:
              "You rewrite repository analysis drafts into one high-quality project overview JSON object. Return JSON only. Use exactly the required schema keys. Prefer concrete file paths and execution steps grounded in the provided dossier. Do not preserve the draft's custom headings or alternate schema."
          },
          {
            role: "user",
            content: buildOverviewRewritePrompt(response.content, language, dossier)
          }
        ]
      });
      logOverviewRawResponse(this.output, "glm5_rewrite_pass_raw_response", rewritten.content);
      parsed = safeParseJsonObject(rewritten.content);
    }

    if (!parsed || !looksLikeProjectOverviewJson(parsed)) {
      this.output.appendLine("[overview] parse_failed_or_schema_mismatch first_pass; trying JSON repair pass");
      const repaired = await adapter.completeChat({
        model: modelConfig.model,
        temperature: 0,
        maxTokens: Math.min(modelConfig.maxTokens || 4096, 4096),
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "project_overview_repair_response",
            schema: PROJECT_OVERVIEW_RESPONSE_SCHEMA,
            strict: true
          }
        },
        messages: [
          {
            role: "system",
            content:
              'You repair malformed assistant output into one strict JSON object. Return JSON only, no markdown, no explanations. The first character must be "{" and the last character must be "}". Preserve original factual content and field values whenever possible.'
          },
          {
            role: "user",
            content: buildOverviewRepairPrompt(response.content, language, {
              modelName: modelConfig.model
            })
          }
        ]
      });
      logOverviewRawResponse(this.output, "repair_pass_raw_response", repaired.content);
      parsed = safeParseJsonObject(repaired.content);
    }

    if (!parsed) {
      throw new Error("Project overview model response was not valid JSON.");
    }

    const normalizedOverview = normalizeGeneratedProjectOverview(parsed, language, {
      workspaceId: index.snapshot.id,
      revision: index.snapshot.revision,
      generatedAt: nowIso(),
      sourceFiles: dossier.fileDossiers.map((item) => item.path)
    });
    const overview = applyDeterministicOverviewFallback(normalizedOverview, {
      dossier,
      index,
      language,
      modelName: modelConfig.model
    });

    this.overview = overview;
    await this.saveOverviewToDisk(overview);
    this.status = "ready";
    this.lastError = "";
    this.output.appendLine(`[overview] done revision=${overview.sourceRevision}`);
    this.emitter.fire();
    return overview;
  }

  private syncStatusWithIndex(): void {
    const index = this.indexService.getIndex();
    if (!index) {
      this.status = this.overview ? "stale" : "idle";
      return;
    }

    if (!this.overview) {
      if (this.status !== "generating" && this.status !== "error") {
        this.status = "idle";
      }
      return;
    }

    const language = this.overview.language;
    const revisionMatches = this.overview.sourceRevision === index.snapshot.revision;
    const languageMatches = language === getCachedWorkspaceLanguage();

    if (this.status === "generating") {
      return;
    }

    this.status = revisionMatches && languageMatches ? "ready" : "stale";
  }
  private async loadOverviewFromDisk(): Promise<GeneratedProjectOverview | null> {
    try {
      const raw = await fs.readFile(this.getOverviewFilePath(), "utf8");
      const parsed = JSON.parse(raw) as GeneratedProjectOverview;
      return parsed?.schemaVersion === 1 ? sanitizeGeneratedProjectOverview(parsed) : null;
    } catch {
      return null;
    }
  }

  private async saveOverviewToDisk(overview: GeneratedProjectOverview): Promise<void> {
    await fs.mkdir(this.storageRoot, { recursive: true });
    await fs.writeFile(this.getOverviewFilePath(), `${JSON.stringify(overview, null, 2)}\n`, "utf8");
  }

  private getOverviewFilePath(): string {
    return path.join(this.storageRoot, PROJECT_OVERVIEW_FILE_NAME);
  }
}

async function buildProjectOverviewDossier(
  index: WorkspaceIndex,
  rootPath: string
): Promise<ProjectOverviewDossier> {
  const summary = generateProjectSummary(index);
  const fileCandidates = selectOverviewFiles(index, summary);
  const fileDossiers = await Promise.all(
    fileCandidates.map(async (candidate) => ({
      path: candidate.path,
      reason: candidate.reason,
      symbolOutline: buildSymbolOutline(index, candidate.path),
      excerpt: await readCodeExcerpt(index, rootPath, candidate.path)
    }))
  );

  const readme = await readTextFile(path.join(rootPath, "README.md"), 7000);
  const packageManifest =
    index.fileContents["package.json"]?.slice(0, 5000) ??
    (await readTextFile(path.join(rootPath, "package.json"), 5000));

  return {
    primaryLanguage: summary.primaryLanguage,
    coreDirectories: summary.coreDirectories,
    entryCandidates: summary.entryFiles,
    coreModules: summary.coreModules,
    topFunctions: summary.topFunctions.map((item) => `${item.name} @ ${item.path} (${item.calls})`),
    readme,
    packageManifest,
    fileDossiers: fileDossiers.filter((item) => item.excerpt.trim().length > 0)
  };
}

function selectOverviewFiles(
  index: WorkspaceIndex,
  summary: ProjectSummary
): Array<{ path: string; reason: string }> {
  const seen = new Set<string>();
  const selected: Array<{ path: string; reason: string }> = [];
  const fileNodes = index.nodes.filter((node) => node.kind === "file");
  const fileSet = new Set(fileNodes.map((node) => node.path));

  const push = (filePath: string, reason: string): void => {
    if (!filePath || seen.has(filePath)) {
      return;
    }
    if (!fileSet.has(filePath) && filePath !== "package.json") {
      return;
    }
    seen.add(filePath);
    selected.push({ path: filePath, reason });
  };

  push("package.json", "Project manifest and scripts");

  for (const entryFile of summary.entryFiles.slice(0, 3)) {
    push(entryFile, "Likely startup entry");
  }

  for (const modulePath of summary.coreModules.slice(0, 4)) {
    const representative = pickRepresentativeModuleFile(index, modulePath);
    if (representative) {
      push(representative, `Representative file for core module: ${modulePath}`);
    }
  }

  for (const item of summary.topFunctions.slice(0, 4)) {
    push(item.path, `Frequently referenced function: ${item.name}`);
  }

  const fallbackPatterns = [/^(src\/)?main\./, /^(src\/)?index\./, /^(src\/)?app\./, /^(src\/)?server\./];
  for (const node of fileNodes) {
    if (selected.length >= 8) {
      break;
    }
    if (fallbackPatterns.some((pattern) => pattern.test(node.path))) {
      push(node.path, "Common startup or application file");
    }
  }

  return selected.slice(0, 8);
}

function pickRepresentativeModuleFile(index: WorkspaceIndex, modulePath: string): string | null {
  const fileNodes = index.nodes.filter((node) => node.kind === "file");
  const candidates = fileNodes.filter(
    (node) => node.path === modulePath || node.path.startsWith(`${modulePath}/`)
  );

  const ranked = candidates
    .filter((node) => !/\.(test|spec)\./.test(node.path))
    .sort(
      (left, right) =>
        scoreOverviewFile(index, right.path) - scoreOverviewFile(index, left.path) ||
        left.path.localeCompare(right.path)
    );

  return ranked[0]?.path ?? candidates[0]?.path ?? null;
}

function scoreOverviewFile(index: WorkspaceIndex, filePath: string): number {
  const symbolCount = index.nodes.filter(
    (node) => node.path === filePath && node.kind !== "file"
  ).length;
  const baseName = filePath.split("/").pop() ?? "";
  let score = symbolCount * 4;

  if (/^(index|main|app|server)\./.test(baseName)) {
    score += 12;
  }

  if (/\.(test|spec)\./.test(baseName)) {
    score -= 8;
  }

  return score;
}

function buildSymbolOutline(index: WorkspaceIndex, filePath: string): string {
  const symbols = index.nodes
    .filter((node) => node.path === filePath && node.kind !== "file")
    .sort((left, right) => left.rangeStartLine - right.rangeStartLine)
    .slice(0, 16);

  return symbols
    .map((symbol) => `- ${symbol.kind} ${symbol.name} (${symbol.rangeStartLine}-${symbol.rangeEndLine})`)
    .join("\n");
}

async function readCodeExcerpt(
  index: WorkspaceIndex,
  rootPath: string,
  filePath: string
): Promise<string> {
  const fromIndex = index.fileContents[filePath];
  if (typeof fromIndex === "string" && fromIndex.trim().length > 0) {
    return truncateText(fromIndex, 7000);
  }

  return readTextFile(path.join(rootPath, filePath), 7000);
}

async function readTextFile(filePath: string, maxChars: number): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return truncateText(raw, maxChars);
  } catch {
    return "";
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

export function safeParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = normalizeModelJsonText(content);
  const direct = parseJsonCandidate(trimmed);
  if (direct) {
    return direct;
  }

  for (const block of extractMarkdownCodeBlocks(trimmed)) {
    const cleanedBlock = normalizeModelJsonText(block);
    const fencedParsed = parseJsonCandidate(cleanedBlock);
    if (fencedParsed) {
      return unwrapProjectOverviewEnvelope(fencedParsed);
    }
  }

  const candidates = dedupeStringItems([
    ...extractJsonObjectCandidates(trimmed),
    ...extractJsonObjectCandidates(stripMarkdownCodeFences(trimmed))
  ]);
  const scored = candidates
    .map((candidate) => parseJsonCandidate(normalizeModelJsonText(candidate)))
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
    .map(unwrapProjectOverviewEnvelope)
    .map((candidate) => ({
      candidate,
      score: scoreProjectOverviewCandidate(candidate)
    }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.candidate ?? null;
}

function logOverviewRawResponse(
  output: vscode.OutputChannel,
  label: string,
  content: string
): void {
  output.appendLine(`[overview] ${label}_start`);
  output.appendLine(content);
  output.appendLine(`[overview] ${label}_end`);
}

function normalizeModelJsonText(content: string): string {
  return stripMarkdownCodeFences(content).replace(/^\uFEFF/, "").trim();
}

function stripMarkdownCodeFences(content: string): string {
  const trimmed = content.trim();
  const entireFenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\s*[\r\n]+([\s\S]*?)\s*```$/);
  return entireFenceMatch?.[1]?.trim() ?? trimmed;
}

function extractMarkdownCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const pattern = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/g;

  for (const match of content.matchAll(pattern)) {
    const block = match[1]?.trim();
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

function extractJsonObjectCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (let start = content.indexOf("{"); start >= 0; start = content.indexOf("{", start + 1)) {
    const extracted = extractBalancedJsonObjectAt(content, start);
    if (extracted) {
      candidates.push(extracted);
    }
  }

  return candidates;
}

function dedupeStringItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function extractBalancedJsonObjectAt(content: string, start: number): string | null {
  if (start < 0 || content[start] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return null;
}

function scoreProjectOverviewCandidate(candidate: Record<string, unknown>): number {
  const keys = [
    "projectGoal",
    "implementationNarrative",
    "startupEntry",
    "startupFlow",
    "keyModules",
    "executionFlow",
    "flowDiagram",
    "uncertainty"
  ];
  let score = 0;

  for (const key of keys) {
    if (key in candidate) {
      score += 2;
    }
  }

  const startupEntry = candidate.startupEntry;
  if (isRecord(startupEntry)) {
    if (typeof startupEntry.file === "string") {
      score += 1;
    }
    if (typeof startupEntry.summary === "string") {
      score += 1;
    }
    if (typeof startupEntry.logic === "string") {
      score += 1;
    }
  }

  if (Array.isArray(candidate.startupFlow)) {
    score += 1;
  }
  if (Array.isArray(candidate.keyModules)) {
    score += 1;
  }
  if (Array.isArray(candidate.executionFlow)) {
    score += 1;
  }

  return score;
}

function looksLikeProjectOverviewJson(value: Record<string, unknown>): boolean {
  return scoreProjectOverviewCandidate(value) >= 8 || looksLikeAlternateProjectOverviewJson(value);
}

function looksLikeAlternateProjectOverviewJson(value: Record<string, unknown>): boolean {
  const alternateKeys = [
    "project_name",
    "project_goal",
    "project_identity",
    "entry_points",
    "execution_flow",
    "key_modules",
    "core_modules",
    "uncertainties"
  ];

  const matchedKeys = alternateKeys.filter((key) => key in value).length;
  if (matchedKeys >= 3) {
    return true;
  }

  return isRecord(value.project_identity) && ("primary_goal" in value.project_identity || "name" in value.project_identity);
}

function unwrapProjectOverviewEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  if (looksLikeProjectOverviewJson(value)) {
    return value;
  }

  const nestedKeys = ["overview", "data", "result", "output"] as const;
  for (const key of nestedKeys) {
    const nested = value[key];
    if (isRecord(nested) && scoreProjectOverviewCandidate(nested) > scoreProjectOverviewCandidate(value)) {
      return nested;
    }
  }

  return value;
}

export function buildOverviewRepairPrompt(
  rawResponse: string,
  language: WorkspaceLanguage,
  options?: { modelName?: string }
): string {
  const languageHint = language === "zh-CN" ? "Simplified Chinese" : "English";
  const modelName = options?.modelName?.trim() ?? "";
  const schemaHint = [
    "Output exactly one JSON object with these keys:",
    "projectGoal, implementationNarrative, startupEntry, startupFlow, keyModules, executionFlow, flowDiagram, uncertainty.",
    "startupEntry must include: file, summary, logic.",
    "startupFlow items must include: title, file, summary, details.",
    "keyModules items must include: name, file, responsibility.",
    "executionFlow items must include: id, title, file, summary, next.",
    "Do not replace existing meaningful values with empty strings.",
    "Use empty strings or empty arrays only when the original content has no recoverable value for that field.",
    `Natural-language fields must be in ${languageHint}.`
  ].join("\n");

  const glmHint = isGlm5ModelName(modelName)
    ? [
        "Do not preserve or emit alternate top-level keys such as project_identity, entry_points, core_modules, model_architecture, reward_system, configuration, dependencies, uncertainties, or core_execution_path.",
        "Map all useful content into the required schema keys only.",
        "Prefer concrete file paths and train_*.py entry scripts when supported by the malformed content.",
        "Prefer executionFlow as a chronological array of concrete runtime steps, not thematic sections."
      ].join("\n")
    : "";

  return `${schemaHint}${glmHint ? `\n${glmHint}` : ""}\n\nMalformed content:\n${rawResponse}`;
}

function isGlm5ModelName(modelName: string): boolean {
  return /^glm-?5\b/i.test(modelName);
}

export function shouldRunOverviewRewritePass(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) {
    return false;
  }

  return scoreProjectOverviewCandidate(parsed) < 8;
}

export function applyDeterministicOverviewFallback(
  overview: GeneratedProjectOverview,
  context: {
    dossier: ProjectOverviewDossier;
    index: WorkspaceIndex;
    language: WorkspaceLanguage;
    modelName: string;
  }
): GeneratedProjectOverview {
  if (!isGlm5ModelName(context.modelName)) {
    return overview;
  }

  const summary = generateProjectSummary(context.index);
  const fallback = buildDeterministicOverviewFallback(overview, context.dossier, summary, context.language, context.index);
  const replaceStartupEntry = shouldReplaceStartupEntry(overview.startupEntry);
  const replaceStartupFlow = shouldReplaceStartupFlow(overview.startupFlow);
  const replaceKeyModules = shouldReplaceKeyModules(overview.keyModules);
  const replaceExecutionFlow = shouldReplaceExecutionFlow(overview.executionFlow);

  return sanitizeGeneratedProjectOverview({
    ...overview,
    projectGoal: preferRicherText(overview.projectGoal, fallback.projectGoal),
    implementationNarrative: preferRicherText(
      overview.implementationNarrative,
      fallback.implementationNarrative
    ),
    startupEntry: replaceStartupEntry ? fallback.startupEntry : overview.startupEntry,
    startupFlow: replaceStartupFlow ? fallback.startupFlow : overview.startupFlow,
    keyModules: replaceKeyModules ? fallback.keyModules : overview.keyModules,
    executionFlow: replaceExecutionFlow ? fallback.executionFlow : overview.executionFlow,
    flowDiagram: replaceExecutionFlow ? fallback.flowDiagram : overview.flowDiagram,
    uncertainty: mergeUncertaintyText(overview.uncertainty, fallback.uncertainty, context.language)
  });
}

function buildDeterministicOverviewFallback(
  overview: GeneratedProjectOverview,
  dossier: ProjectOverviewDossier,
  summary: ProjectSummary,
  language: WorkspaceLanguage,
  index: WorkspaceIndex
): GeneratedProjectOverview {
  const candidateFiles = buildFallbackFileList(dossier, summary, index);
  const entryFile = pickBestOverviewEntryFile(candidateFiles, summary, dossier, index);
  const fileDossierLookup = new Map(dossier.fileDossiers.map((item) => [item.path, item]));
  const entryDossier = entryFile ? fileDossierLookup.get(entryFile) ?? null : null;
  const startupFlow = candidateFiles
    .filter((filePath) => filePath !== "package.json")
    .slice(0, 4)
    .map((filePath, indexPosition) =>
      buildDeterministicStartupStep(
        filePath,
        fileDossierLookup.get(filePath) ?? null,
        indexPosition,
        language
      )
    );
  const keyModules = candidateFiles
    .filter((filePath) => filePath !== "package.json")
    .slice(0, 5)
    .map((filePath) =>
      buildDeterministicKeyModule(
        filePath,
        fileDossierLookup.get(filePath) ?? null,
        language
      )
    );
  const executionFlow = buildDeterministicExecutionFlow(summary, startupFlow, language);

  return {
    ...overview,
    projectGoal:
      buildDeterministicProjectGoal(overview, dossier, summary, language),
    implementationNarrative: buildDeterministicImplementationNarrative(
      dossier,
      summary,
      startupFlow,
      language
    ),
    startupEntry: {
      file: entryFile,
      summary: buildDeterministicEntrySummary(entryFile, entryDossier, language),
      logic: buildDeterministicEntryLogic(entryFile, dossier, summary, language)
    },
    startupFlow,
    keyModules,
    executionFlow,
    flowDiagram: buildFlowDiagram(executionFlow),
    uncertainty: buildDeterministicUncertainty(dossier, entryFile, language)
  };
}

function buildFallbackFileList(
  dossier: ProjectOverviewDossier,
  summary: ProjectSummary,
  index: WorkspaceIndex
): string[] {
  const files = new Set<string>();

  for (const filePath of summary.entryFiles) {
    if (filePath) {
      files.add(filePath);
    }
  }

  for (const item of dossier.fileDossiers) {
    if (item.path) {
      files.add(item.path);
    }
  }

  for (const modulePath of summary.coreModules) {
    const representative = pickRepresentativeModuleFile(index, modulePath);
    if (representative) {
      files.add(representative);
    }
  }

  for (const item of summary.topFunctions) {
    if (item.path) {
      files.add(item.path);
    }
  }

  return [...files];
}

function pickBestOverviewEntryFile(
  candidateFiles: readonly string[],
  summary: ProjectSummary,
  dossier: ProjectOverviewDossier,
  index: WorkspaceIndex
): string {
  const dossierLookup = new Map(dossier.fileDossiers.map((item) => [item.path, item]));
  const ranked = candidateFiles
    .filter((filePath) => filePath && filePath !== "package.json")
    .map((filePath) => ({
      filePath,
      score:
        (summary.entryFiles.includes(filePath) ? 100 : 0) +
        (/\/?train[_-]|^train[_-]|\/?main\.|\/?index\.|\/?app\.|\/?server\./i.test(filePath) ? 40 : 0) +
        (dossierLookup.get(filePath)?.reason.toLowerCase().includes("entry") ? 25 : 0) +
        (dossierLookup.has(filePath) ? 10 : 0) +
        scoreOverviewFile(index, filePath) -
        (/utils?|helper/i.test(filePath) ? 15 : 0)
    }))
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  return ranked[0]?.filePath ?? "";
}

function buildDeterministicProjectGoal(
  overview: GeneratedProjectOverview,
  dossier: ProjectOverviewDossier,
  summary: ProjectSummary,
  language: WorkspaceLanguage
): string {
  if (looksUsefulNarrative(overview.projectGoal)) {
    return overview.projectGoal;
  }

  const coreArea = summary.coreModules[0] || dossier.coreDirectories[0] || dossier.primaryLanguage;
  return language === "zh-CN"
    ? `该项目是一个以 ${coreArea} 为核心的 ${dossier.primaryLanguage} 代码库，围绕可执行入口、核心模块和关键函数组织主要行为。`
    : `This repository is a ${dossier.primaryLanguage} codebase centered on ${coreArea}, with its main behavior organized around executable entry files, core modules, and frequently used functions.`;
}

function buildDeterministicImplementationNarrative(
  dossier: ProjectOverviewDossier,
  summary: ProjectSummary,
  startupFlow: ProjectOverviewStartupStep[],
  language: WorkspaceLanguage
): string {
  const entryHint = summary.entryFiles[0] || startupFlow[0]?.file || "the visible entry candidate";
  const moduleHint = summary.coreModules[0] || dossier.coreDirectories[0] || dossier.primaryLanguage;
  const functionHint = summary.topFunctions[0]?.name || "";

  return language === "zh-CN"
    ? `仓库以 ${entryHint} 这类可执行入口驱动主流程，核心实现集中在 ${moduleHint} 相关文件中，并通过共享函数${functionHint ? `（如 ${functionHint}）` : ""}把入口、核心模块和运行时路径连接起来。`
    : `The repository is driven by executable entry files such as ${entryHint}, keeps most core behavior in ${moduleHint}-related files, and connects entry logic, core modules, and runtime paths through shared functions${functionHint ? ` such as ${functionHint}` : ""}.`;
}

function buildDeterministicEntrySummary(
  entryFile: string,
  entryDossier: ProjectOverviewFileDossier | null,
  language: WorkspaceLanguage
): string {
  const reason = entryDossier?.reason || "";
  if (language === "zh-CN") {
    return reason ? `${entryFile} 被优先视为入口，因为索引和采样都把它指向主流程。` : `${entryFile} 是当前最强的可见入口候选文件。`;
  }
  return reason
    ? `${entryFile} is treated as the entry because both the index and sampled files point to it as part of the main path.`
    : `${entryFile} is the strongest visible entry candidate in the current dossier.`;
}

function buildDeterministicEntryLogic(
  entryFile: string,
  dossier: ProjectOverviewDossier,
  summary: ProjectSummary,
  language: WorkspaceLanguage
): string {
  const topFunction = summary.topFunctions[0]?.name;
  const sampled = dossier.fileDossiers.some((item) => item.path === entryFile);
  return language === "zh-CN"
    ? `${entryFile || "该候选文件"} 同时出现在入口候选和采样文件附近${topFunction ? `，并与高频函数 ${topFunction} 相关联` : ""}${sampled ? "，因此优先作为主入口解释。" : "，因此优先作为主入口候选。"}`
    : `${entryFile || "This candidate file"} appears close to the entry candidates and sampled files${topFunction ? ` and is connected to frequently referenced functions such as ${topFunction}` : ""}${sampled ? ", so it is used as the primary entry explanation." : ", so it is used as the strongest visible entry candidate."}`;
}

function buildDeterministicStartupStep(
  filePath: string,
  dossier: ProjectOverviewFileDossier | null,
  indexPosition: number,
  language: WorkspaceLanguage
): ProjectOverviewStartupStep {
  const baseName = filePath.split("/").pop() ?? filePath;
  const reason = dossier?.reason || "";
  const symbolSummary = summarizeSymbolOutline(dossier?.symbolOutline || "", language);

  return {
    title: deriveStartupTitle(filePath, reason, indexPosition, language),
    file: filePath,
    summary:
      language === "zh-CN"
        ? `${baseName} 在当前采样中承担${reason || "主流程相关"}职责。`
        : `${baseName} carries a visible ${reason || "main-path"} responsibility in the sampled files.`,
    details: symbolSummary
  };
}

function buildDeterministicKeyModule(
  filePath: string,
  dossier: ProjectOverviewFileDossier | null,
  language: WorkspaceLanguage
): ProjectOverviewKeyModule {
  const baseName = filePath.split("/").pop() ?? filePath;
  const reason = dossier?.reason || "";
  const symbolSummary = summarizeSymbolOutline(dossier?.symbolOutline || "", language);

  return {
    name: baseName,
    file: filePath,
    responsibility:
      language === "zh-CN"
        ? `${reason || "核心实现文件"}。${symbolSummary}`
        : `${reason || "Core implementation file"}. ${symbolSummary}`
  };
}

function buildDeterministicExecutionFlow(
  summary: ProjectSummary,
  startupFlow: ProjectOverviewStartupStep[],
  language: WorkspaceLanguage
): ProjectOverviewFlowNode[] {
  const functionNodes = summary.topFunctions
    .slice(0, 5)
    .map((item, indexPosition, items) => ({
      id: sanitizeFlowId(item.name, indexPosition),
      title: language === "zh-CN" ? `执行 ${item.name}` : `Execute ${item.name}`,
      file: item.path,
      summary:
        language === "zh-CN"
          ? `${item.name} 是索引里引用较多的关键函数，位于 ${item.path}。`
          : `${item.name} is a frequently referenced function in the index and lives in ${item.path}.`,
      next: indexPosition < items.length - 1 ? [sanitizeFlowId(items[indexPosition + 1]?.name || "", indexPosition + 1)] : []
    }));

  if (functionNodes.length > 0) {
    return functionNodes;
  }

  return startupFlow.map((step, indexPosition, items) => ({
    id: sanitizeFlowId(step.title, indexPosition),
    title: step.title,
    file: step.file,
    summary: step.summary,
    next: indexPosition < items.length - 1 ? [sanitizeFlowId(items[indexPosition + 1]?.title || "", indexPosition + 1)] : []
  }));
}

function buildFlowDiagram(nodes: readonly ProjectOverviewFlowNode[]): string {
  if (nodes.length === 0) {
    return "";
  }

  return ["flowchart TD", ...nodes.flatMap((node) => node.next.map((next) => `    ${node.id} --> ${next}`))].join("\n");
}

function buildDeterministicUncertainty(
  dossier: ProjectOverviewDossier,
  entryFile: string,
  language: WorkspaceLanguage
): string {
  const entryNote = entryFile
    ? language === "zh-CN"
      ? `入口基于当前索引候选和采样文件推断，优先采用 ${entryFile} 作为最强可见候选。`
      : `The entry is inferred from the current index candidates and sampled files, with ${entryFile} used as the strongest visible candidate.`
    : language === "zh-CN"
      ? "当前索引没有给出完全确定的入口文件，因此入口说明基于候选文件和采样内容推断。"
      : "The current index does not expose a fully certain entry file, so the entry explanation is inferred from candidate files and sampled content.";

  const sampleNote =
    language === "zh-CN"
      ? `本结果基于 ${dossier.fileDossiers.length} 个采样文件，而不是整个仓库的完整源码转储。`
      : `This result is grounded in ${dossier.fileDossiers.length} sampled files rather than a full dump of the entire repository.`;

  return `${entryNote} ${sampleNote}`;
}

function shouldReplaceStartupEntry(entry: GeneratedProjectOverview["startupEntry"]): boolean {
  return !isConcretePath(entry.file) || !looksUsefulNarrative(entry.summary) || !looksUsefulNarrative(entry.logic);
}

function shouldReplaceStartupFlow(steps: readonly ProjectOverviewStartupStep[]): boolean {
  return steps.length < 2 || steps.filter((step) => isConcretePath(step.file)).length < Math.min(2, steps.length);
}

function shouldReplaceKeyModules(modules: readonly ProjectOverviewKeyModule[]): boolean {
  return modules.length < 3 || modules.filter((module) => isConcretePath(module.file)).length < Math.min(3, modules.length);
}

function shouldReplaceExecutionFlow(nodes: readonly ProjectOverviewFlowNode[]): boolean {
  return nodes.length < 3 || nodes.filter((node) => isConcretePath(node.file)).length < Math.min(2, nodes.length);
}

function preferRicherText(primary: string, fallback: string): string {
  return looksUsefulNarrative(primary) ? primary : fallback;
}

function mergeUncertaintyText(primary: string, fallback: string, language: WorkspaceLanguage): string {
  if (!primary.trim()) {
    return fallback;
  }

  if (primary.includes(fallback)) {
    return primary;
  }

  return language === "zh-CN" ? `${primary} ${fallback}` : `${primary} ${fallback}`;
}

function isConcretePath(value: string): boolean {
  const normalized = value.trim();
  return Boolean(normalized) && !/(unknown|inferred|likely|candidate|not provided|未提供|推断|候选)/i.test(normalized);
}

function looksUsefulNarrative(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 24 && !/^(unknown|n\/a|none)$/i.test(normalized);
}

function summarizeSymbolOutline(outline: string, language: WorkspaceLanguage): string {
  const symbols = outline
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .slice(0, 3);

  if (symbols.length === 0) {
    return language === "zh-CN" ? "索引未提供足够的符号细节。" : "The index did not expose enough symbol detail.";
  }

  return language === "zh-CN"
    ? `可见符号包括：${symbols.join("；")}。`
    : `Visible symbols include: ${symbols.join("; ")}.`;
}

function deriveStartupTitle(
  filePath: string,
  reason: string,
  indexPosition: number,
  language: WorkspaceLanguage
): string {
  const baseName = filePath.split("/").pop() ?? filePath;

  if (/train[_-]|main\.|index\.|app\.|server\./i.test(baseName)) {
    return language === "zh-CN" ? "入口初始化" : "Entry Initialization";
  }

  if (/entry/i.test(reason)) {
    return language === "zh-CN" ? "入口装配" : "Entry Assembly";
  }

  if (/core module/i.test(reason)) {
    return language === "zh-CN" ? "核心模块加载" : "Core Module Load";
  }

  return language === "zh-CN" ? `启动步骤 ${indexPosition + 1}` : `Startup Step ${indexPosition + 1}`;
}

function sanitizeFlowId(value: string, indexPosition: number): string {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return base ? base.slice(0, 32) : `step-${indexPosition + 1}`;
}

function buildOverviewRewritePrompt(
  rawResponse: string,
  language: WorkspaceLanguage,
  dossier: ProjectOverviewDossier
): string {
  const languageHint = language === "zh-CN" ? "Simplified Chinese" : "English";

  return [
    `Rewrite the draft below into exactly one JSON object in ${languageHint}.`,
    "Use exactly these top-level keys and no others:",
    "projectGoal, implementationNarrative, startupEntry, startupFlow, keyModules, executionFlow, flowDiagram, uncertainty.",
    "Requirements:",
    "- startupEntry must be one object with file, summary, logic.",
    "- startupFlow must contain bootstrap steps only.",
    "- keyModules must contain 3 to 5 concrete files or modules with stable responsibilities.",
    "- executionFlow must contain 4 to 6 chronological runtime steps when the dossier supports them.",
    "- Prefer concrete file paths from Entry candidates and Grounded source sample files.",
    "- If the exact entry file is not fully confirmed, choose the strongest visible candidate and explain the gap in uncertainty.",
    "- Do not keep alternate draft sections such as project_identity, entry_points, core_modules, reward_system, dependencies, or data_flow.",
    "",
    `Entry candidates: ${dossier.entryCandidates.join(", ") || "none"}`,
    `Grounded source sample files: ${dossier.fileDossiers.map((item) => item.path).join(", ") || "none"}`,
    `Core modules: ${dossier.coreModules.join(", ") || "none"}`,
    `Top functions: ${dossier.topFunctions.join(" | ") || "none"}`,
    "",
    "Draft to rewrite:",
    rawResponse
  ].join("\n");
}

function parseJsonCandidate(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
