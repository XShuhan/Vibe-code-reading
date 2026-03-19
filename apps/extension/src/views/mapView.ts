import * as vscode from "vscode";
import path from "node:path";

import { getCallers, getCallees, getNodeChildren } from "@code-vibe/analyzer";
import { COMMANDS } from "@code-vibe/shared";
import type { CodeNode, WorkspaceIndex } from "@code-vibe/shared";

import { getCachedWorkspaceLanguage, onDidChangeWorkspacePreferences } from "../config/settings";
import type { IndexService } from "../services/indexService";
import type { ProjectOverviewService } from "../services/projectOverviewService";

interface DirectoryNode {
  id: string;
  kind: "directory";
  name: string;
  path: string;
}

interface OverviewNode {
  id: string;
  kind: "overview";
  name: string;
  path: string;
}

type SymbolGroupType = "variables" | "functions" | "classes";

interface SymbolGroupNode {
  id: string;
  kind: "symbolGroup";
  nodeType: "symbolGroup";
  name: string;
  groupType: SymbolGroupType;
  fileNodeId: string;
}

type CallDirection = "callers" | "callees";

interface CallDirectionNode {
  id: string;
  kind: "callChain";
  nodeType: "callDirection";
  name: CallDirection;
  direction: CallDirection;
  anchorNodeId: string;
  currentNodeId: string;
  depth: number;
  visited: string[];
}

interface CallSymbolNode {
  id: string;
  kind: "callChain";
  nodeType: "callSymbol";
  name: string;
  path: string;
  rangeStartLine: number;
  rangeEndLine: number;
  direction: CallDirection;
  anchorNodeId: string;
  currentNodeId: string;
  depth: number;
  visited: string[];
}

type MapNode =
  | CodeNode
  | DirectoryNode
  | OverviewNode
  | SymbolGroupNode
  | CallDirectionNode
  | CallSymbolNode;

const MAX_CALL_CHAIN_DEPTH = 5;

interface DirectoryTreeIndex {
  rootDirectories: string[];
  childDirectoriesByParent: Map<string, string[]>;
  filesByParent: Map<string, CodeNode[]>;
}

export class MapViewProvider implements vscode.TreeDataProvider<MapNode> {
  private readonly emitter = new vscode.EventEmitter<MapNode | undefined>();
  private directoryTreeCache: { revision: string; index: DirectoryTreeIndex } | null = null;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly indexService: IndexService,
    private readonly projectOverviewService: ProjectOverviewService
  ) {
    this.indexService.onDidChange(() => this.emitter.fire(undefined));
    this.projectOverviewService.onDidChange(() => this.emitter.fire(undefined));
    onDidChangeWorkspacePreferences(() => this.emitter.fire(undefined));
  }

  getTreeItem(node: MapNode): vscode.TreeItem {
    if (isOverviewNode(node)) {
      const overview = this.projectOverviewService.getOverview();
      const status = this.projectOverviewService.getStatus();
      const item = new vscode.TreeItem(
        localizeOverviewLabel(),
        vscode.TreeItemCollapsibleState.None
      );
      item.description = describeOverviewStatus(
        status,
        overview?.sourceRevision === this.indexService.getIndex()?.snapshot.revision
          ? undefined
          : this.indexService.getProjectSummary()?.primaryLanguage
      );
      item.tooltip = localizeOverviewTooltip(status);
      item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
      item.command = {
        command: COMMANDS.openProjectOverview,
        title: getCachedWorkspaceLanguage() === "zh-CN" ? "打开项目概览" : "Open Project Overview"
      };
      return item;
    }

    if (isDirectoryNode(node)) {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = node.path;
      item.tooltip = node.path;
      item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
      return item;
    }

    if (isCallDirectionNode(node)) {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `depth ${node.depth}`;
      item.tooltip = `Call ${node.direction}`;
      item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
      return item;
    }

    if (isSymbolGroupNode(node)) {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = node.groupType;
      item.tooltip = `${node.groupType} in file`;
      item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
      return item;
    }

    if (isCallSymbolNode(node)) {
      const item = new vscode.TreeItem(
        node.name,
        node.depth < MAX_CALL_CHAIN_DEPTH
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      );
      item.description = `${node.path}:${node.rangeStartLine}`;
      item.tooltip = `${node.path}:${node.rangeStartLine}-${node.rangeEndLine}`;
      item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
      item.command = {
        command: COMMANDS.openCitation,
        title: "Open Source",
        arguments: [
          {
            id: node.id,
            path: node.path,
            startLine: node.rangeStartLine,
            endLine: node.rangeEndLine,
            symbolId: node.currentNodeId,
            label: `${node.path}:${node.rangeStartLine}-${node.rangeEndLine}`
          }
        ]
      };
      return item;
    }

    const collapsibleState = this.getChildren(node).then((children) =>
      children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    const item = new vscode.TreeItem(
      node.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = node.kind === "file" ? node.path : node.kind;
    item.tooltip = `${node.path}:${node.rangeStartLine}-${node.rangeEndLine}`;
    item.iconPath = new vscode.ThemeIcon(themeIconForNode(node.kind));
    item.command = {
      command: COMMANDS.openCitation,
      title: "Open Source",
      arguments: [
        {
          id: node.id,
          path: node.path,
          startLine: node.rangeStartLine,
          endLine: node.rangeEndLine,
          symbolId: node.id,
          label: `${node.path}:${node.rangeStartLine}-${node.rangeEndLine}`
        }
      ]
    };
    void collapsibleState.then((resolved) => {
      item.collapsibleState = resolved;
    });
    return item;
  }

  async getChildren(element?: MapNode): Promise<MapNode[]> {
    const index = this.indexService.getIndex();
    if (!index) {
      return [];
    }

    const tree = this.ensureDirectoryTree(index.snapshot.revision, index.nodes);

    if (!element) {
      const overview = createOverviewNode(index.snapshot.id);
      const rootDirectories = tree.rootDirectories
        .map((directoryPath) => toDirectoryNode(index.snapshot.id, directoryPath));
      const rootFiles = tree.filesByParent.get("") ?? [];
      return [overview, ...rootDirectories, ...rootFiles];
    }

    if (isOverviewNode(element)) {
      return [];
    }

    if (isDirectoryNode(element)) {
      const childDirectories = (tree.childDirectoriesByParent.get(element.path) ?? [])
        .map((directoryPath) => toDirectoryNode(index.snapshot.id, directoryPath));
      const childFiles = tree.filesByParent.get(element.path) ?? [];
      return [...childDirectories, ...childFiles];
    }

    if (isSymbolGroupNode(element)) {
      const fileNode = index.nodes.find((node) => node.id === element.fileNodeId);
      if (!fileNode) {
        return [];
      }
      const grouped = this.groupFileChildren(index, fileNode);
      if (element.groupType === "variables") {
        return grouped.variables;
      }
      if (element.groupType === "functions") {
        return grouped.functions;
      }
      return grouped.classes;
    }

    if (isCallDirectionNode(element) || isCallSymbolNode(element)) {
      return this.expandCallChain(index, element.direction, element.anchorNodeId, element.currentNodeId, element.depth, element.visited);
    }

    if (supportsCallChain(element)) {
      const children = getNodeChildren(index, element.id);
      const callRoots: MapNode[] = [
        createCallDirectionNode(index.snapshot.id, "callers", element.id),
        createCallDirectionNode(index.snapshot.id, "callees", element.id)
      ];
      return [...callRoots, ...children];
    }

    if (element.kind === "file") {
      const grouped = this.groupFileChildren(index, element);
      const groups: MapNode[] = [];
      if (grouped.variables.length > 0) {
        groups.push(createSymbolGroupNode(index.snapshot.id, element.id, "variables"));
      }
      if (grouped.functions.length > 0) {
        groups.push(createSymbolGroupNode(index.snapshot.id, element.id, "functions"));
      }
      if (grouped.classes.length > 0) {
        groups.push(createSymbolGroupNode(index.snapshot.id, element.id, "classes"));
      }
      return [...groups, ...grouped.others];
    }

    return getNodeChildren(index, element.id);
  }

  private groupFileChildren(
    index: WorkspaceIndex,
    fileNode: CodeNode
  ): {
    variables: CodeNode[];
    functions: CodeNode[];
    classes: CodeNode[];
    others: CodeNode[];
  } {
    const children = getNodeChildren(index, fileNode.id);
    const variables = children.filter((node) => node.kind === "variable");
    const functions = children.filter(
      (node) => node.kind === "function" || node.kind === "method"
    );
    const classes = children.filter((node) => node.kind === "class");
    const others = children.filter(
      (node) =>
        node.kind !== "variable" &&
        node.kind !== "function" &&
        node.kind !== "method" &&
        node.kind !== "class"
    );

    return {
      variables,
      functions,
      classes,
      others
    };
  }

  private expandCallChain(
    index: WorkspaceIndex,
    direction: CallDirection,
    anchorNodeId: string,
    currentNodeId: string,
    depth: number,
    visited: string[]
  ): MapNode[] {
    if (depth >= MAX_CALL_CHAIN_DEPTH) {
      return [];
    }

    const visitedSet = new Set(visited);
    visitedSet.add(currentNodeId);

    const related = direction === "callers"
      ? getCallers(index, currentNodeId)
      : getCallees(index, currentNodeId);

    const nodeById = new Map(index.nodes.map((node) => [node.id, node]));

    return related
      .filter((node) => !visitedSet.has(node.id))
      .map((node) =>
        createCallSymbolNode(
          index.snapshot.id,
          direction,
          anchorNodeId,
          node,
          toCallTreeDisplayName(node, nodeById),
          depth + 1,
          [...visitedSet]
        )
      );
  }

  private ensureDirectoryTree(revision: string, nodes: readonly CodeNode[]): DirectoryTreeIndex {
    if (this.directoryTreeCache?.revision === revision) {
      return this.directoryTreeCache.index;
    }

    const files = nodes
      .filter((node) => node.kind === "file")
      .sort((left, right) => left.path.localeCompare(right.path));

    const directoryTree = buildDirectoryTree(files.map((file) => toPosixPath(file.path)));
    const filesByParent = new Map<string, CodeNode[]>();
    for (const file of files) {
      const normalized = toPosixPath(file.path);
      const parentPath = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
      const bucket = filesByParent.get(parentPath) ?? [];
      bucket.push(file);
      filesByParent.set(parentPath, bucket);
    }

    this.directoryTreeCache = {
      revision,
      index: {
        rootDirectories: directoryTree.childrenByParent.get("") ?? [],
        childDirectoriesByParent: directoryTree.childrenByParent,
        filesByParent
      }
    };
    return this.directoryTreeCache.index;
  }
}

function themeIconForNode(kind: CodeNode["kind"]): string {
  switch (kind) {
    case "overview":
      return "dashboard";
    case "directory":
      return "folder";
    case "callChain":
      return "symbol-event";
    case "symbolGroup":
      return "list-tree";
    case "class":
      return "symbol-class";
    case "function":
      return "symbol-function";
    case "method":
      return "symbol-method";
    case "interface":
      return "symbol-interface";
    case "type":
      return "symbol-key";
    case "variable":
      return "symbol-variable";
    case "file":
    default:
      return "file-code";
  }
}

function isDirectoryNode(node: MapNode): node is DirectoryNode {
  return node.kind === "directory";
}

function isOverviewNode(node: MapNode): node is OverviewNode {
  return node.kind === "overview";
}

function isCallDirectionNode(node: MapNode): node is CallDirectionNode {
  return node.kind === "callChain" && "nodeType" in node && node.nodeType === "callDirection";
}

function isSymbolGroupNode(node: MapNode): node is SymbolGroupNode {
  return node.kind === "symbolGroup" && "nodeType" in node && node.nodeType === "symbolGroup";
}

function isCallSymbolNode(node: MapNode): node is CallSymbolNode {
  return node.kind === "callChain" && "nodeType" in node && node.nodeType === "callSymbol";
}

function createOverviewNode(workspaceId: string): OverviewNode {
  return {
    id: `${workspaceId}:overview`,
    kind: "overview",
    name: localizeOverviewLabel(),
    path: "overview"
  };
}

function localizeOverviewLabel(): string {
  return getCachedWorkspaceLanguage() === "zh-CN" ? "项目概览" : "Project Overview";
}

function describeOverviewStatus(
  status: ReturnType<ProjectOverviewService["getStatus"]>,
  fallback: string | undefined
): string {
  const language = getCachedWorkspaceLanguage();
  if (status === "generating") {
    return language === "zh-CN" ? "分析中" : "Analyzing";
  }
  if (status === "stale") {
    return language === "zh-CN" ? "待刷新" : "Stale";
  }
  if (status === "error") {
    return language === "zh-CN" ? "生成失败" : "Error";
  }
  return fallback ?? "AI";
}

function localizeOverviewTooltip(status: ReturnType<ProjectOverviewService["getStatus"]>): string {
  const language = getCachedWorkspaceLanguage();
  if (status === "generating") {
    return language === "zh-CN"
      ? "正在根据最新索引生成 AI 项目概览"
      : "Generating an AI project overview from the latest index";
  }
  if (status === "stale") {
    return language === "zh-CN"
      ? "索引或语言已变更，请刷新以重新生成项目概览"
      : "The index or language changed. Refresh to regenerate the project overview.";
  }
  if (status === "error") {
    return language === "zh-CN"
      ? "项目概览生成失败，点击查看详情"
      : "Project overview generation failed. Click to inspect details.";
  }
  return language === "zh-CN" ? "项目概览" : "Project overview";
}

function createCallDirectionNode(
  workspaceId: string,
  direction: CallDirection,
  anchorNodeId: string
): CallDirectionNode {
  return {
    id: `${workspaceId}:call-direction:${direction}:${anchorNodeId}`,
    kind: "callChain",
    nodeType: "callDirection",
    name: direction,
    direction,
    anchorNodeId,
    currentNodeId: anchorNodeId,
    depth: 0,
    visited: []
  };
}

function createSymbolGroupNode(
  workspaceId: string,
  fileNodeId: string,
  groupType: SymbolGroupType
): SymbolGroupNode {
  const displayName =
    groupType === "variables"
      ? "Variables"
      : groupType === "functions"
        ? "Functions"
        : "Classes";

  return {
    id: `${workspaceId}:symbol-group:${fileNodeId}:${groupType}`,
    kind: "symbolGroup",
    nodeType: "symbolGroup",
    name: displayName,
    groupType,
    fileNodeId
  };
}

function createCallSymbolNode(
  workspaceId: string,
  direction: CallDirection,
  anchorNodeId: string,
  symbol: CodeNode,
  displayName: string,
  depth: number,
  visited: string[]
): CallSymbolNode {
  return {
    id: `${workspaceId}:call-symbol:${direction}:${anchorNodeId}:${symbol.id}:${depth}`,
    kind: "callChain",
    nodeType: "callSymbol",
    name: displayName,
    path: symbol.path,
    rangeStartLine: symbol.rangeStartLine,
    rangeEndLine: symbol.rangeEndLine,
    direction,
    anchorNodeId,
    currentNodeId: symbol.id,
    depth,
    visited
  };
}

function toCallTreeDisplayName(node: CodeNode, nodeById: Map<string, CodeNode>): string {
  if (node.kind === "method" && node.parentId) {
    const parent = nodeById.get(node.parentId);
    if (parent?.kind === "class") {
      return `${parent.name}.${node.name}`;
    }
  }

  return node.name;
}

function supportsCallChain(node: CodeNode): boolean {
  return node.kind === "function" || node.kind === "method";
}

function toDirectoryNode(workspaceId: string, directoryPath: string): DirectoryNode {
  const parts = directoryPath.split("/");
  const name = parts[parts.length - 1] ?? directoryPath;
  return {
    id: `${workspaceId}:directory:${directoryPath}`,
    kind: "directory",
    name,
    path: directoryPath
  };
}

function buildDirectoryTree(files: string[]): {
  childrenByParent: Map<string, string[]>;
} {
  const directories = new Set<string>();

  for (const filePath of files) {
    const segments = filePath.split("/");
    segments.pop();

    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      directories.add(currentPath);
    }
  }

  const sortedDirectories = [...directories].sort((left, right) => left.localeCompare(right));
  const childrenByParent = new Map<string, string[]>();
  for (const directory of sortedDirectories) {
    const parent = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";
    const bucket = childrenByParent.get(parent) ?? [];
    bucket.push(directory);
    childrenByParent.set(parent, bucket);
  }

  for (const [parent, children] of childrenByParent.entries()) {
    childrenByParent.set(parent, children.sort((left, right) => left.localeCompare(right)));
  }

  return {
    childrenByParent
  };
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}
