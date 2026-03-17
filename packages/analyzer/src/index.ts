import type { CodeEdge, CodeNode, TracePathResult, WorkspaceIndex } from "@code-vibe/shared";

import { indexTypeScriptWorkspace } from "./ts/tsAnalyzer";
export { getCallers, getCallees } from "./ts/callGraph";

export async function indexWorkspace(rootUri: string): Promise<WorkspaceIndex> {
  return indexTypeScriptWorkspace(rootUri);
}

export async function refreshFiles(rootUri: string, _uris: string[]): Promise<WorkspaceIndex> {
  return indexWorkspace(rootUri);
}

export function getNodeByLocation(
  index: WorkspaceIndex,
  filePath: string,
  line: number
): CodeNode | null {
  const candidates = index.nodes.filter(
    (node) =>
      node.path === filePath && node.rangeStartLine <= line && node.rangeEndLine >= line
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (left, right) =>
      (left.rangeEndLine - left.rangeStartLine) - (right.rangeEndLine - right.rangeStartLine)
  );
  return candidates[0] ?? null;
}

export function getNeighbors(index: WorkspaceIndex, nodeId: string): CodeEdge[] {
  return index.edges.filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId);
}

export function traceCallPath(index: WorkspaceIndex, nodeId: string): TracePathResult {
  return {
    anchorNodeId: nodeId,
    callers: index.edges.filter((edge) => edge.type === "calls" && edge.toNodeId === nodeId),
    callees: index.edges.filter((edge) => edge.type === "calls" && edge.fromNodeId === nodeId),
    neighbors: getNeighbors(index, nodeId).filter((edge) => edge.type !== "calls")
  };
}

export function getNodeChildren(index: WorkspaceIndex, parentId: string): CodeNode[] {
  return index.nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.rangeStartLine - right.rangeStartLine);
}

export function getNodeMap(index: WorkspaceIndex): Map<string, CodeNode> {
  return new Map(index.nodes.map((node) => [node.id, node]));
}
