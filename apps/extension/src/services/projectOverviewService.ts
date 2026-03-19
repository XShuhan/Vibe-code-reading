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
    const { systemInstruction, userPrompt } = buildProjectOverviewPrompt(language, dossier, index);
    const adapter = createModelAdapter(modelConfig);

    this.output.appendLine(
      `[overview] start reason=${reason} files=${dossier.fileDossiers.length} revision=${index.snapshot.revision}`
    );

    const response = await adapter.completeChat({
      model: modelConfig.model,
      temperature: Math.min(Math.max(modelConfig.temperature ?? 0.1, 0), 0.4),
      maxTokens: Math.min(modelConfig.maxTokens || 4096, 4096),
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

    const parsed = safeParseJsonObject(response.content);
    if (!parsed) {
      throw new Error("Project overview model response was not valid JSON.");
    }

    const overview = normalizeGeneratedProjectOverview(parsed, language, {
      workspaceId: index.snapshot.id,
      revision: index.snapshot.revision,
      generatedAt: nowIso(),
      sourceFiles: dossier.fileDossiers.map((item) => item.path)
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

function safeParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = parseJsonCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  return fenced ? parseJsonCandidate(fenced) : null;
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
