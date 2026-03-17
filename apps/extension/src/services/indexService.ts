import * as vscode from "vscode";

import { getNodeByLocation, indexWorkspace, refreshFiles } from "@code-vibe/analyzer";
import type { CodeNode, WorkspaceIndex } from "@code-vibe/shared";

import type { PersistenceLayer } from "@code-vibe/persistence";

export interface ProjectSummary {
  primaryLanguage: string;
  coreDirectories: string[];
  entryFiles: string[];
  coreModules: string[];
  topFunctions: Array<{
    name: string;
    path: string;
    calls: number;
  }>;
}

export class IndexService {
  private index: WorkspaceIndex | null = null;
  private projectSummary: ProjectSummary | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  private refreshInFlight: Promise<WorkspaceIndex> | null = null;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly rootPath: string,
    private readonly persistence: PersistenceLayer,
    private readonly output: vscode.OutputChannel
  ) {}

  async initialize(): Promise<void> {
    const persisted = await this.persistence.loadIndex();
    if (persisted?.snapshot.rootUri === this.rootPath) {
      this.index = persisted;
      this.projectSummary = generateProjectSummary(persisted);
      this.emitter.fire();
    }

    await this.refresh("startup");
  }

  getIndex(): WorkspaceIndex | null {
    return this.index;
  }

  getWorkspaceId(): string {
    return this.index?.snapshot.id ?? `workspace_${hashText(this.rootPath)}`;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  getProjectSummary(): ProjectSummary | null {
    return this.projectSummary;
  }

  async ensureIndex(): Promise<WorkspaceIndex> {
    if (this.index) {
      return this.index;
    }

    return this.refresh("lazy");
  }

  async refresh(reason: string): Promise<WorkspaceIndex> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.output.appendLine(`[index] start reason=${reason}`);
    this.refreshInFlight = indexWorkspace(this.rootPath)
      .then(async (index) => {
        this.index = index;
        this.projectSummary = generateProjectSummary(index);
        await this.persistence.saveIndex(index);
        this.output.appendLine(
          `[index] end files=${Object.keys(index.fileContents).length} nodes=${index.nodes.length} edges=${index.edges.length}`
        );
        this.emitter.fire();
        return index;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  async refreshFile(uri: vscode.Uri): Promise<void> {
    if (!isIndexableFile(uri.fsPath)) {
      return;
    }

    this.output.appendLine(`[index] refresh save=${uri.fsPath}`);
    const index = await refreshFiles(this.rootPath, [uri.fsPath]);
    this.index = index;
    this.projectSummary = generateProjectSummary(index);
    await this.persistence.saveIndex(index);
    this.emitter.fire();
  }

  getNodeByLocation(filePath: string, line: number): CodeNode | null {
    return this.index ? getNodeByLocation(this.index, filePath, line) : null;
  }
}

function isIndexableFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|py|sh|bash|zsh|json|jsonc)$/.test(filePath);
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function generateProjectSummary(index: WorkspaceIndex): ProjectSummary {
  const fileNodes = index.nodes.filter((node) => node.kind === "file");
  const symbolNodes = index.nodes.filter((node) => node.kind !== "file");
  const nodeById = new Map(index.nodes.map((node) => [node.id, node]));
  const functionNodes = index.nodes.filter(
    (node) => node.kind === "function" || node.kind === "method"
  );

  const extensionCounts = new Map<string, number>();
  for (const file of fileNodes) {
    const extension = file.path.includes(".") ? file.path.slice(file.path.lastIndexOf(".") + 1).toLowerCase() : "";
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  const primaryLanguage = extensionToLanguage(
    [...extensionCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ""
  );

  const directoryCounts = new Map<string, number>();
  for (const file of fileNodes) {
    const first = file.path.split("/")[0] ?? "";
    if (first) {
      directoryCounts.set(first, (directoryCounts.get(first) ?? 0) + 1);
    }
  }

  const coreDirectories = [...directoryCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([directory]) => directory);

  const entryFiles = resolveEntryFiles(fileNodes, functionNodes, index);

  const moduleCounts = new Map<string, number>();
  for (const node of symbolNodes) {
    const parts = node.path.split("/");
    const moduleKey = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "root");
    moduleCounts.set(moduleKey, (moduleCounts.get(moduleKey) ?? 0) + 1);
  }

  const coreModules = [...moduleCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([module]) => module);

  const callCounts = new Map<string, number>();
  for (const edge of index.edges) {
    if (edge.type === "calls") {
      callCounts.set(edge.toNodeId, (callCounts.get(edge.toNodeId) ?? 0) + 1);
    }
  }

  const topFunctions = [...callCounts.entries()]
    .map(([nodeId, calls]) => ({ node: nodeById.get(nodeId), calls }))
    .filter((entry): entry is { node: CodeNode; calls: number } => Boolean(entry.node))
    .filter((entry) => entry.node.kind === "function")
    .sort((left, right) => right.calls - left.calls || left.node.name.localeCompare(right.node.name))
    .slice(0, 5)
    .map((entry) => ({
      name: entry.node.name,
      path: entry.node.path,
      calls: entry.calls
    }));

  return {
    primaryLanguage,
    coreDirectories,
    entryFiles,
    coreModules,
    topFunctions
  };
}

function resolveEntryFiles(
  fileNodes: CodeNode[],
  functionNodes: CodeNode[],
  index: WorkspaceIndex
): string[] {
  const fileSet = new Set(fileNodes.map((node) => node.path));
  const preferredOrder = [
    "index.ts",
    "main.ts",
    "app.ts",
    "server.ts",
    "src/index.ts",
    "src/main.ts",
    "src/app.ts"
  ];

  for (const candidate of preferredOrder) {
    if (fileSet.has(candidate)) {
      return [candidate];
    }
  }

  const topCalledFunction = [...index.edges]
    .filter((edge) => edge.type === "calls")
    .reduce<Map<string, number>>((acc, edge) => {
      acc.set(edge.toNodeId, (acc.get(edge.toNodeId) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

  const topNodeId = [...topCalledFunction.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  if (topNodeId) {
    const fallbackNode = functionNodes.find((node) => node.id === topNodeId);
    if (fallbackNode) {
      return [fallbackNode.path];
    }
  }

  return [];
}

function extensionToLanguage(extension: string): string {
  switch (extension) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "TypeScript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "JavaScript";
    case "py":
      return "Python";
    case "sh":
    case "bash":
    case "zsh":
      return "Shell";
    case "json":
    case "jsonc":
      return "JSON";
    default:
      return "Unknown";
  }
}

