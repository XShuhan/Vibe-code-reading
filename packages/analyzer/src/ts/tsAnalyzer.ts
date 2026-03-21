import type { CodeEdge, CodeNode, WorkspaceIndex } from "@code-vibe/shared";

import { analyzeTextFile } from "../text/textAnalyzer";
import { scanWorkspaceFiles } from "../core/fileScanner";
import { createWorkspaceSnapshot } from "../core/workspaceSnapshot";
import { buildCallEdges } from "./callGraph";
import { buildImportEdges } from "./importGraph";
import { analyzeSourceFile } from "./symbolExtractor";

export async function indexTypeScriptWorkspace(rootPath: string): Promise<WorkspaceIndex> {
  const scannedFiles = await scanWorkspaceFiles(rootPath);
  const fileSignature = scannedFiles
    .map((file) => `${file.relativePath}:${file.content.length}`)
    .join("|");
  const languageSet = collectLanguageSet(scannedFiles.map((file) => file.relativePath));
  const snapshot = createWorkspaceSnapshot(rootPath, fileSignature, languageSet);

  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const fileContents: Record<string, string> = {};
  const importCandidates = new Map<string, string[]>();
  const callReferences: Array<{
    callerNodeId: string;
    filePath: string;
    name: string;
    receiverText?: string;
    containerName?: string;
  }> = [];

  for (const file of scannedFiles) {
    fileContents[file.relativePath] = file.content;
    try {
      const result = isTypeScriptFamily(file.relativePath)
        ? analyzeSourceFile({
            content: file.content,
            path: file.relativePath,
            workspaceId: snapshot.id
          })
        : analyzeTextFile({
            content: file.content,
            path: file.relativePath,
            workspaceId: snapshot.id
          });

      appendMany(nodes, result.nodes);
      appendMany(edges, result.containsEdges);
      importCandidates.set(result.fileNode.path, result.importSpecifiers);
      appendMany(callReferences, result.callReferences);
    } catch (error) {
      // Parsing failures should be isolated to the file.
      process.stderr.write(`[vibe][analyzer] failed to parse ${file.relativePath}: ${String(error)}\n`);
    }
  }

  const fileNodesByPath = new Map<string, CodeNode>(
    nodes.filter((node) => node.kind === "file").map((node) => [node.path, node])
  );

  for (const [filePath, importSpecifiers] of importCandidates.entries()) {
    const fileNode = fileNodesByPath.get(filePath);
    if (!fileNode) {
      continue;
    }

    appendMany(edges, buildImportEdges(snapshot.id, fileNode, importSpecifiers, fileNodesByPath));
  }

  appendMany(edges, buildCallEdges(snapshot.id, nodes, callReferences));

  return {
    snapshot,
    nodes,
    edges,
    fileContents
  };
}

function collectLanguageSet(paths: string[]): string[] {
  const languages = new Set<string>();
  for (const filePath of paths) {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
      languages.add("typescript");
    }
    if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) {
      languages.add("javascript");
    }
    if (/\.py$/.test(filePath)) {
      languages.add("python");
    }
    if (/\.(c|h)$/.test(filePath)) {
      languages.add("c");
    }
    if (/\.(cc|cpp|cxx|hh|hpp|hxx)$/.test(filePath)) {
      languages.add("cpp");
    }
    if (/\.(sh|bash|zsh)$/.test(filePath)) {
      languages.add("shell");
    }
    if (/\.(json|jsonc)$/.test(filePath)) {
      languages.add("json");
    }
  }
  return [...languages];
}

function isTypeScriptFamily(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

function appendMany<T>(target: T[], values: readonly T[]): void {
  for (const value of values) {
    target.push(value);
  }
}
