import type { WorkspaceIndex } from "@code-vibe/shared";

import type {
  GeneratedProjectOverview,
  ProjectOverviewDossier,
  ProjectOverviewFlowNode,
  ProjectOverviewKeyModule,
  ProjectOverviewStartupStep
} from "../services/projectOverviewService";
import type { WorkspaceLanguage } from "../config/settings";

const PROJECT_OVERVIEW_SYSTEM_PROMPT = [
  "You are the Project Overview agent for Code Vibe Reading.",
  "Your job is to explain a repository at project level with concrete code grounding.",
  "Do not give generic architecture advice.",
  "Trace the actual startup path and the code path that turns the project goal into behavior.",
  "Prefer precise file paths, symbol names, and execution order.",
  "When the dossier is incomplete, state uncertainty explicitly instead of hallucinating."
].join(" ");

const PROJECT_OVERVIEW_SKILLS = [
  {
    id: "MissionSkill",
    focus: "Explain what the project is for, who it serves, and the main user-facing outcome."
  },
  {
    id: "BootstrapTraceSkill",
    focus:
      "Identify likely startup entry files, the bootstrap path, and the key functions/modules involved in bringing the project up."
  },
  {
    id: "ExecutionFlowSkill",
    focus:
      "Turn the startup path and core request/render loop into a readable flow diagram with grounded step descriptions."
  }
] as const;

export interface ProjectOverviewPromptPackage {
  systemInstruction: string;
  userPrompt: string;
}

export function buildProjectOverviewPrompt(
  language: WorkspaceLanguage,
  dossier: ProjectOverviewDossier,
  index: WorkspaceIndex
): ProjectOverviewPromptPackage {
  const languageInstruction =
    language === "zh-CN"
      ? "Write every natural-language field in Simplified Chinese."
      : "Write every natural-language field in English.";

  const outputSchema = [
    "{",
    '  "projectGoal": "string",',
    '  "implementationNarrative": "string",',
    '  "startupEntry": {',
    '    "file": "string",',
    '    "summary": "string",',
    '    "logic": "string"',
    "  },",
    '  "startupFlow": [',
    "    {",
    '      "title": "string",',
    '      "file": "string",',
    '      "summary": "string",',
    '      "details": "string"',
    "    }",
    "  ],",
    '  "keyModules": [',
    "    {",
    '      "name": "string",',
    '      "file": "string",',
    '      "responsibility": "string"',
    "    }",
    "  ],",
    '  "executionFlow": [',
    "    {",
    '      "id": "string",',
    '      "title": "string",',
    '      "file": "string",',
    '      "summary": "string",',
    '      "next": ["string"]',
    "    }",
    "  ],",
    '  "flowDiagram": "string",',
    '  "uncertainty": "string"',
    "}"
  ].join("\n");

  const skillSection = PROJECT_OVERVIEW_SKILLS.map(
    (skill, indexPosition) => `${indexPosition + 1}. ${skill.id}: ${skill.focus}`
  ).join("\n");

  const dossierSections = [
    `Workspace root: ${index.snapshot.rootUri}`,
    `Workspace revision: ${index.snapshot.revision}`,
    `Indexed languages: ${index.snapshot.languageSet.join(", ") || "unknown"}`,
    `Primary language hint: ${dossier.primaryLanguage}`,
    `Provided code excerpts: ${dossier.fileDossiers.length}`,
    `Grounded source sample files: ${dossier.fileDossiers.map((item) => item.path).join(", ") || "none"}`,
    `Core directories: ${dossier.coreDirectories.join(", ") || "none"}`,
    `Entry candidates: ${dossier.entryCandidates.join(", ") || "none"}`,
    `Core modules: ${dossier.coreModules.join(", ") || "none"}`,
    `Top functions: ${dossier.topFunctions.join(" | ") || "none"}`,
    "",
    "Repository signals",
    dossier.readme ? `README.md\n${dossier.readme}` : "README.md not available.",
    "",
    dossier.packageManifest ? `package.json\n${dossier.packageManifest}` : "package.json not available.",
    "",
    "Code excerpts",
    dossier.fileDossiers
      .map((fileDossier) =>
        [
          `File: ${fileDossier.path}`,
          `Why this matters: ${fileDossier.reason}`,
          `Symbol outline:\n${fileDossier.symbolOutline || "No indexed symbols captured."}`,
          `Code excerpt:\n${fileDossier.excerpt || "No excerpt available."}`
        ].join("\n")
      )
      .join("\n\n")
  ].join("\n");

  const userPrompt = [
    languageInstruction,
    "Use the following local skill bundle while reasoning:",
    skillSection,
    "",
    "Return a strict JSON object only. Do not wrap it in markdown fences.",
    "Requirements:",
    "- `projectGoal`: explain what the whole project does.",
    "- `implementationNarrative`: explain how the codebase achieves that goal at repository level, not as a step-by-step trace.",
    "- `startupEntry`: identify the most likely startup entry file and explain why it is treated as the entry.",
    "- `startupFlow`: describe only initialization/bootstrap steps. Stop once the application is ready to serve its main job.",
    "- `keyModules`: list 3 to 5 stable responsibility owners. This section is not chronological and must not restate `startupFlow` step text.",
    "- `executionFlow`: describe the main runtime path from input/request to output/result after startup. If runtime flow is effectively the same as startup, return an empty array.",
    "- `flowDiagram`: output a Mermaid `flowchart TD` string using node ids from `executionFlow`. If `executionFlow` is empty, return an empty string.",
    "- `uncertainty`: mention missing evidence, ambiguous entry points, or sample coverage limits.",
    "- If code excerpts are present in the dossier, do not say that source code was missing. Say that the answer is based on sampled files only.",
    "- Keep every statement grounded in the dossier.",
    "- Prefer concise, high-signal prose that a developer can scan quickly.",
    "",
    "JSON schema:",
    outputSchema,
    "",
    "Grounding dossier:",
    dossierSections
  ].join("\n");

  return {
    systemInstruction: PROJECT_OVERVIEW_SYSTEM_PROMPT,
    userPrompt
  };
}

export function normalizeGeneratedProjectOverview(
  parsed: Record<string, unknown>,
  fallbackLanguage: WorkspaceLanguage,
  metadata: {
    workspaceId: string;
    revision: string;
    generatedAt: string;
    sourceFiles: string[];
  }
): GeneratedProjectOverview {
  return sanitizeGeneratedProjectOverview({
    schemaVersion: 1,
    workspaceId: metadata.workspaceId,
    sourceRevision: metadata.revision,
    generatedAt: metadata.generatedAt,
    language: fallbackLanguage,
    projectGoal: readString(parsed.projectGoal),
    implementationNarrative: readString(parsed.implementationNarrative),
    startupEntry: normalizeStartupEntry(parsed.startupEntry),
    startupFlow: readArray(parsed.startupFlow, normalizeStartupStep).slice(0, 8),
    keyModules: readArray(parsed.keyModules, normalizeKeyModule).slice(0, 8),
    executionFlow: normalizeExecutionFlow(parsed.executionFlow).slice(0, 8),
    flowDiagram: readString(parsed.flowDiagram),
    uncertainty: readString(parsed.uncertainty),
    sourceFiles: metadata.sourceFiles
  });
}

export function sanitizeGeneratedProjectOverview(
  overview: GeneratedProjectOverview
): GeneratedProjectOverview {
  const startupFlow = dedupeItems(
    overview.startupFlow,
    (step) => `${normalizePath(step.file)}|${normalizeText(step.title)}`
  );
  const keyModules = dedupeItems(
    overview.keyModules,
    (module) => `${normalizePath(module.file)}|${normalizeText(module.name)}`
  );
  const executionFlow = dedupeItems(
    overview.executionFlow,
    (node) => `${node.id}|${normalizePath(node.file)}|${normalizeText(node.title)}`
  );
  const sourceFiles = dedupeItems(overview.sourceFiles, (item) => normalizePath(item));
  const collapseExecutionFlow = areFlowSectionsRedundant(startupFlow, executionFlow);
  const startupEntry = {
    file:
      overview.startupEntry.file ||
      startupFlow[0]?.file ||
      keyModules[0]?.file ||
      "",
    summary: overview.startupEntry.summary,
    logic: overview.startupEntry.logic
  };

  return {
    ...overview,
    startupEntry,
    startupFlow,
    keyModules,
    executionFlow: collapseExecutionFlow ? [] : executionFlow,
    flowDiagram: collapseExecutionFlow ? "" : overview.flowDiagram.trim(),
    uncertainty: buildEvidenceBoundaryText(
      overview.language,
      sourceFiles,
      overview.uncertainty
    ),
    sourceFiles
  };
}

function normalizeStartupEntry(value: unknown): GeneratedProjectOverview["startupEntry"] {
  const record = isRecord(value) ? value : {};
  return {
    file: readString(record.file),
    summary: readString(record.summary),
    logic: readString(record.logic)
  };
}

function normalizeStartupStep(value: unknown): ProjectOverviewStartupStep {
  const record = isRecord(value) ? value : {};
  return {
    title: readString(record.title),
    file: readString(record.file),
    summary: readString(record.summary),
    details: readString(record.details)
  };
}

function normalizeKeyModule(value: unknown): ProjectOverviewKeyModule {
  const record = isRecord(value) ? value : {};
  return {
    name: readString(record.name),
    file: readString(record.file),
    responsibility: readString(record.responsibility)
  };
}

function normalizeExecutionFlow(value: unknown): ProjectOverviewFlowNode[] {
  return readArray(value, (item) => {
    const record = isRecord(item) ? item : {};
    return {
      id: readIdentifier(record.id),
      title: readString(record.title),
      file: readString(record.file),
      summary: readString(record.summary),
      next: readArray(record.next, (nextItem) => readIdentifier(nextItem)).filter(Boolean)
    };
  }).filter((node) => node.id && node.title);
}

function readArray<T>(value: unknown, mapper: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readIdentifier(value: unknown): string {
  const raw = readString(value);
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupeItems<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function areFlowSectionsRedundant(
  startupFlow: ProjectOverviewStartupStep[],
  executionFlow: ProjectOverviewFlowNode[]
): boolean {
  if (startupFlow.length === 0 || executionFlow.length < 2) {
    return false;
  }

  const startupKeys = new Set(
    startupFlow.map((step) => `${normalizePath(step.file)}|${normalizeText(step.title)}`)
  );
  const executionKeys = executionFlow.map(
    (node) => `${normalizePath(node.file)}|${normalizeText(node.title)}`
  );
  const exactOverlap =
    executionKeys.filter((key) => key && startupKeys.has(key)).length /
    Math.max(executionKeys.length, 1);
  const fileOverlap = computeSetOverlap(
    new Set(startupFlow.map((step) => normalizePath(step.file)).filter(Boolean)),
    new Set(executionFlow.map((node) => normalizePath(node.file)).filter(Boolean))
  );
  const textOverlap = computeSetOverlap(
    collectTokens(startupFlow.flatMap((step) => [step.title, step.summary, step.details])),
    collectTokens(executionFlow.flatMap((node) => [node.title, node.summary]))
  );

  return exactOverlap >= 0.6 || (fileOverlap >= 0.8 && textOverlap >= 0.65);
}

function computeSetOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const item of right) {
    if (left.has(item)) {
      matches += 1;
    }
  }

  return matches / Math.max(Math.min(left.size, right.size), 1);
}

function collectTokens(values: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const match of value.toLowerCase().match(/[a-z0-9_\u4e00-\u9fff]+/g) ?? []) {
      if (match.length >= 2) {
        tokens.add(match);
      }
    }
  }
  return tokens;
}

function buildEvidenceBoundaryText(
  language: WorkspaceLanguage,
  sourceFiles: string[],
  rawUncertainty: string
): string {
  const cleaned = rawUncertainty.trim();
  const hasSourceSamples = sourceFiles.length > 0;
  const coveragePrefix =
    language === "zh-CN"
      ? hasSourceSamples
        ? `本次概览基于 ${sourceFiles.length} 个送入模型的源码/配置样本生成，限制主要来自样本覆盖范围，而不是完全没有源码。`
        : "本次概览没有读到可直接送入模型的源码摘录，只能更多依赖索引摘要、README 或配置文件。"
      : hasSourceSamples
        ? `This overview is grounded in ${sourceFiles.length} source or config samples sent to the model, so the main limit is sample coverage rather than a total absence of source code.`
        : "This overview did not include source excerpts directly sent to the model, so it relies more heavily on index summaries, README content, or config files.";

  if (!cleaned) {
    return coveragePrefix;
  }

  if (hasSourceSamples && looksLikeMissingSourceClaim(cleaned)) {
    return coveragePrefix;
  }

  if (cleaned.includes(coveragePrefix)) {
    return cleaned;
  }

  return `${coveragePrefix} ${cleaned}`;
}

function looksLikeMissingSourceClaim(value: string): boolean {
  return [
    /没有找到源码/,
    /未找到源码/,
    /没有源码摘录/,
    /no source code/i,
    /source code .* not available/i,
    /no source excerpts?/i
  ].some((pattern) => pattern.test(value));
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
