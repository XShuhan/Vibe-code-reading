import type { CanvasRelation, CodeEdgeType, CodeNodeKind, ThreadRole } from "./types";

export const codeNodeKinds: CodeNodeKind[] = [
  "file",
  "directory",
  "overview",
  "symbolGroup",
  "callChain",
  "module",
  "class",
  "function",
  "method",
  "interface",
  "type",
  "variable"
];

export const codeEdgeTypes: CodeEdgeType[] = [
  "contains",
  "imports",
  "calls",
  "implements",
  "tests",
  "references"
];

export const threadRoles: ThreadRole[] = ["user", "assistant", "system_internal"];

export const canvasRelations: CanvasRelation[] = [
  "explains",
  "calls",
  "depends_on",
  "tests",
  "related_to",
  "causes",
  "implements"
];

export function isCanvasRelation(value: string): value is CanvasRelation {
  return canvasRelations.includes(value as CanvasRelation);
}

