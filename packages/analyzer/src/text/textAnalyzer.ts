import type { CodeEdge, CodeNode, CodeNodeKind } from "@code-vibe/shared";

import type { CallReference, FileAnalysisResult } from "../core/analysisTypes";

interface AnalyzeParams {
  content: string;
  path: string;
  workspaceId: string;
}

export function analyzeTextFile(params: AnalyzeParams): FileAnalysisResult {
  const lines = params.content.split(/\r?\n/);
  const fileNode = createNode(
    params.workspaceId,
    "file",
    pathBasename(params.path),
    params.path,
    1,
    Math.max(lines.length, 1),
    true
  );

  if (params.path.endsWith(".py")) {
    return analyzePythonFile(params, lines, fileNode);
  }

  if (/\.(c|h|cc|hh|cpp|hpp|cxx|hxx)$/.test(params.path)) {
    return analyzeCppFile(params, lines, fileNode);
  }

  if (/\.(sh|bash|zsh)$/.test(params.path)) {
    return analyzeShellFile(params, lines, fileNode);
  }

  if (/\.(json|jsonc)$/.test(params.path)) {
    return analyzeJsonFile(params, lines, fileNode);
  }

  return {
    fileNode,
    nodes: [fileNode],
    containsEdges: [],
    importSpecifiers: [],
    callReferences: []
  };
}

function analyzePythonFile(
  params: AnalyzeParams,
  lines: string[],
  fileNode: CodeNode
): FileAnalysisResult {
  const nodes: CodeNode[] = [fileNode];
  const containsEdges: CodeEdge[] = [];
  const importSpecifiers: string[] = [];
  const callReferences: CallReference[] = [];
  const stack: Array<{ indent: number; node: CodeNode }> = [{ indent: -1, node: fileNode }];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.node;

    if (trimmed.startsWith("import ")) {
      const modules = trimmed
        .slice("import ".length)
        .split(",")
        .map((part) => normalizePythonImportSpecifier(part.trim().split(/\s+as\s+/)[0]?.trim() ?? ""))
        .filter(Boolean) as string[];
      importSpecifiers.push(...modules);
      continue;
    }

    if (trimmed.startsWith("from ")) {
      const match = trimmed.match(/^from\s+([.\w/]+)\s+import\s+/);
      if (match?.[1]) {
        importSpecifiers.push(normalizePythonImportSpecifier(match[1]));
      }
      continue;
    }

    const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (classMatch?.[1]) {
      const endLine = findPythonBlockEnd(lines, index, indent);
      const node = createNode(
        params.workspaceId,
        "class",
        classMatch[1],
        params.path,
        index + 1,
        endLine,
        true,
        parent.id,
        trimmed
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, parent.id, node.id, "contains"));
      stack.push({ indent, node });
      continue;
    }

    const functionMatch = trimmed.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (functionMatch?.[1]) {
      const kind = parent.kind === "class" ? "method" : "function";
      const endLine = findPythonBlockEnd(lines, index, indent);
      const node = createNode(
        params.workspaceId,
        kind,
        functionMatch[1],
        params.path,
        index + 1,
        endLine,
        true,
        parent.id,
        trimmed
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, parent.id, node.id, "contains"));
      const blockText = lines.slice(index, endLine).join("\n");
      callReferences.push(
        ...extractCallReferencesFromText({
          callerNodeId: node.id,
          filePath: params.path,
          content: blockText,
          containerName: parent.kind === "class" ? parent.name : undefined
        })
      );
      stack.push({ indent, node });
      continue;
    }

    const variableMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (variableMatch?.[1] && parent.id === fileNode.id) {
      const node = createNode(
        params.workspaceId,
        "variable",
        variableMatch[1],
        params.path,
        index + 1,
        index + 1,
        true,
        fileNode.id,
        trimmed
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, fileNode.id, node.id, "contains"));
    }
  }

  return {
    fileNode,
    nodes,
    containsEdges,
    importSpecifiers,
    callReferences
  };
}

function analyzeShellFile(
  params: AnalyzeParams,
  lines: string[],
  fileNode: CodeNode
): FileAnalysisResult {
  const nodes: CodeNode[] = [fileNode];
  const containsEdges: CodeEdge[] = [];
  const importSpecifiers: string[] = [];
  const callReferences: CallReference[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const sourceMatch = trimmed.match(/^(?:source|\.)\s+([^\s;]+)/);
    if (sourceMatch?.[1]) {
      importSpecifiers.push(sourceMatch[1]);
      continue;
    }

    const fnMatch =
      trimmed.match(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{?$/) ??
      trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{$/);
    if (fnMatch?.[1]) {
      const endLine = findShellBlockEnd(lines, index);
      const node = createNode(
        params.workspaceId,
        "function",
        fnMatch[1],
        params.path,
        index + 1,
        endLine,
        true,
        fileNode.id,
        trimmed
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, fileNode.id, node.id, "contains"));
      const blockText = lines.slice(index, endLine).join("\n");
      callReferences.push(
        ...extractShellCallReferences({
          callerNodeId: node.id,
          filePath: params.path,
          content: blockText,
          functionName: node.name
        })
      );
    }
  }

  return {
    fileNode,
    nodes,
    containsEdges,
    importSpecifiers,
    callReferences
  };
}

function analyzeCppFile(
  params: AnalyzeParams,
  lines: string[],
  fileNode: CodeNode
): FileAnalysisResult {
  const nodes: CodeNode[] = [fileNode];
  const containsEdges: CodeEdge[] = [];
  const importSpecifiers: string[] = [];
  const callReferences: CallReference[] = [];
  const stack: Array<{ depth: number; node: CodeNode }> = [{ depth: 0, node: fileNode }];
  let braceDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const cleanedLine = removeCppComment(rawLine).trim();
    if (!cleanedLine) {
      braceDepth += countBraceDelta(rawLine);
      continue;
    }

    const includeMatch = cleanedLine.match(/^#include\s+[<"]([^>"]+)[>"]/);
    if (includeMatch?.[1]) {
      importSpecifiers.push(includeMatch[1]);
      braceDepth += countBraceDelta(rawLine);
      continue;
    }

    while (stack.length > 1 && braceDepth < stack[stack.length - 1]!.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.node;

    const classMatch = cleanedLine.match(/^(?:template\s*<[^>]+>\s*)?(class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (classMatch?.[2]) {
      const endLine = findBraceBlockEnd(lines, index);
      const node = createNode(
        params.workspaceId,
        "class",
        classMatch[2],
        params.path,
        index + 1,
        endLine,
        true,
        parent.id,
        cleanedLine
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, parent.id, node.id, "contains"));
      const opensBlock = rawLine.includes("{");
      if (opensBlock) {
        stack.push({ depth: braceDepth + 1, node });
      }
      braceDepth += countBraceDelta(rawLine);
      continue;
    }

    const functionName = extractCppFunctionName(cleanedLine);
    if (functionName) {
      const kind = parent.kind === "class" ? "method" : "function";
      const endLine = findBraceBlockEnd(lines, index);
      const node = createNode(
        params.workspaceId,
        kind,
        functionName,
        params.path,
        index + 1,
        endLine,
        true,
        parent.id,
        cleanedLine
      );
      nodes.push(node);
      containsEdges.push(createEdge(params.workspaceId, parent.id, node.id, "contains"));
      const blockText = lines.slice(index, endLine).join("\n");
      callReferences.push(
        ...extractCppCallReferences({
          callerNodeId: node.id,
          filePath: params.path,
          content: blockText,
          containerName: parent.kind === "class" ? parent.name : undefined
        })
      );
      const opensBlock = rawLine.includes("{");
      if (opensBlock) {
        stack.push({ depth: braceDepth + 1, node });
      }
      braceDepth += countBraceDelta(rawLine);
      continue;
    }

    braceDepth += countBraceDelta(rawLine);
  }

  return {
    fileNode,
    nodes,
    containsEdges,
    importSpecifiers,
    callReferences
  };
}

function analyzeJsonFile(
  params: AnalyzeParams,
  lines: string[],
  fileNode: CodeNode
): FileAnalysisResult {
  const nodes: CodeNode[] = [fileNode];
  const containsEdges: CodeEdge[] = [];

  try {
    const parsed = JSON.parse(params.content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed as Record<string, unknown>)) {
        const line = findJsonKeyLine(lines, key);
        const node = createNode(
          params.workspaceId,
          "variable",
          key,
          params.path,
          line,
          line,
          true,
          fileNode.id,
          `"${key}"`
        );
        nodes.push(node);
        containsEdges.push(createEdge(params.workspaceId, fileNode.id, node.id, "contains"));
      }
    }
  } catch {
    // Leave JSON files as file-level nodes when parsing fails.
  }

  return {
    fileNode,
    nodes,
    containsEdges,
    importSpecifiers: [],
    callReferences: []
  };
}

function extractCallReferencesFromText(params: {
  callerNodeId: string;
  filePath: string;
  content: string;
  containerName?: string;
}): CallReference[] {
  const references = new Map<string, CallReference>();
  const pattern = /\b(?:(self|this)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of params.content.matchAll(pattern)) {
    const receiverText = match[1];
    const name = match[2];
    if (!name || ignoredCallNames.has(name)) {
      continue;
    }
    references.set(`${receiverText ?? ""}:${name}`, {
      callerNodeId: params.callerNodeId,
      filePath: params.filePath,
      name,
      receiverText,
      containerName: params.containerName
    });
  }

  return [...references.values()];
}

function extractShellCallReferences(params: {
  callerNodeId: string;
  filePath: string;
  content: string;
  functionName: string;
}): CallReference[] {
  const references = new Map<string, CallReference>();
  const lines = params.content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("function ")) {
      continue;
    }

    const token = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/)?.[1];
    if (!token || token === params.functionName || shellBuiltins.has(token)) {
      continue;
    }

    references.set(token, {
      callerNodeId: params.callerNodeId,
      filePath: params.filePath,
      name: token
    });
  }

  return [...references.values()];
}

function extractCppCallReferences(params: {
  callerNodeId: string;
  filePath: string;
  content: string;
  containerName?: string;
}): CallReference[] {
  const references = new Map<string, CallReference>();
  const pattern = /\b(?:([A-Za-z_][A-Za-z0-9_]*)::)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of params.content.matchAll(pattern)) {
    const receiverText = match[1];
    const name = match[2];
    if (!name || ignoredCppCallNames.has(name)) {
      continue;
    }
    references.set(`${receiverText ?? ""}:${name}`, {
      callerNodeId: params.callerNodeId,
      filePath: params.filePath,
      name,
      receiverText,
      containerName: params.containerName
    });
  }

  return [...references.values()];
}

function findPythonBlockEnd(lines: string[], startIndex: number, startIndent: number): number {
  let endLine = startIndex + 1;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= startIndent) {
      break;
    }
    endLine = index + 1;
  }
  return Math.max(endLine, startIndex + 1);
}

function findShellBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpeningBrace = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        sawOpeningBrace = true;
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
        if (sawOpeningBrace && depth === 0) {
          return index + 1;
        }
      }
    }
  }
  return Math.max(startIndex + 1, lines.length);
}

function findBraceBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let started = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        started = true;
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
        if (started && depth === 0) {
          return index + 1;
        }
      }
    }
  }

  return startIndex + 1;
}

function findJsonKeyLine(lines: string[], key: string): number {
  const pattern = new RegExp(`"(${escapeRegExp(key)})"\\s*:`);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function createNode(
  workspaceId: string,
  kind: CodeNodeKind,
  name: string,
  filePath: string,
  startLine: number,
  endLine: number,
  exported: boolean,
  parentId?: string,
  signature?: string
): CodeNode {
  const id = `${workspaceId}:${filePath}:${kind}:${name}:${startLine}`;
  return {
    id,
    workspaceId,
    kind,
    name,
    path: filePath,
    rangeStartLine: startLine,
    rangeEndLine: endLine,
    signature,
    exported,
    parentId
  };
}

function createEdge(
  workspaceId: string,
  fromNodeId: string,
  toNodeId: string,
  type: CodeEdge["type"]
): CodeEdge {
  return {
    id: `${workspaceId}:${type}:${fromNodeId}:${toNodeId}`,
    workspaceId,
    fromNodeId,
    toNodeId,
    type
  };
}

function pathBasename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePythonImportSpecifier(value: string): string {
  if (!value) {
    return value;
  }

  if (value.startsWith(".")) {
    const leadingDots = value.match(/^\.+/)?.[0].length ?? 0;
    const remainder = value.slice(leadingDots).replaceAll(".", "/");
    const relativePrefix = leadingDots === 1 ? "./" : "../".repeat(leadingDots - 1);
    return `${relativePrefix}${remainder}`.replace(/\/+$/, "");
  }

  return `./${value.replaceAll(".", "/")}`;
}

function removeCppComment(value: string): string {
  return value.replace(/\/\/.*$/, "");
}

function countBraceDelta(value: string): number {
  let delta = 0;
  for (const char of value) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}

function extractCppFunctionName(line: string): string | undefined {
  if (!line.includes("(") || line.endsWith(";")) {
    return undefined;
  }

  const controlKeyword = line.match(/^(if|for|while|switch|catch)\s*\(/);
  if (controlKeyword) {
    return undefined;
  }

  const beforeParen = line.split("(")[0]?.trim() ?? "";
  if (!beforeParen) {
    return undefined;
  }

  const token = beforeParen.split(/\s+/).at(-1);
  if (!token) {
    return undefined;
  }

  const normalized = token.includes("::") ? token.split("::").at(-1) : token;
  if (!normalized || !/^[~A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    return undefined;
  }

  if (cppNonFunctionTokens.has(normalized)) {
    return undefined;
  }

  return normalized;
}

const ignoredCallNames = new Set([
  "if",
  "for",
  "while",
  "return",
  "print",
  "len",
  "range",
  "list",
  "dict",
  "set"
]);

const shellBuiltins = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "do",
  "done",
  "case",
  "esac",
  "echo",
  "printf",
  "local",
  "export",
  "return",
  "source"
]);

const ignoredCppCallNames = new Set([
  "if",
  "for",
  "while",
  "switch",
  "return",
  "sizeof",
  "static_cast",
  "reinterpret_cast",
  "const_cast",
  "dynamic_cast"
]);

const cppNonFunctionTokens = new Set(["else", "do", "case", "default"]);
