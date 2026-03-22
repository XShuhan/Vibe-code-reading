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
  "When the dossier is incomplete, state uncertainty explicitly instead of hallucinating.",
  "Your entire reply must be exactly one valid JSON object.",
  "Do not include markdown fences, commentary, headings, or any text before or after the JSON.",
  'The first character of the reply must be "{" and the last character must be "}".'
].join(" ");

const GLM5_PROJECT_OVERVIEW_SYSTEM_PROMPT_ADDON = [
  "You are currently being evaluated on strict schema compliance and repository-level usefulness.",
  "Do not invent alternative section names, wrapper objects, or analysis headings.",
  "Do not reorganize the answer into project_identity, entry_points, core_modules, architecture, dependencies, reward_system, configuration, or any other custom schema.",
  "If a fact is uncertain, keep the required field and explain the uncertainty inside the uncertainty string.",
  "Prefer concrete repository facts over broad conceptual summaries.",
  "Prefer specific file paths from the dossier over guessed paths.",
  "Do not use placeholders like Unknown or Likely unless the dossier truly lacks evidence, and then explain that in uncertainty."
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
  index: WorkspaceIndex,
  options?: {
    modelName?: string;
  }
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
  const modelName = options?.modelName?.trim() ?? "";
  const systemInstruction = isGlm5Model(modelName)
    ? `${PROJECT_OVERVIEW_SYSTEM_PROMPT} ${GLM5_PROJECT_OVERVIEW_SYSTEM_PROMPT_ADDON}`
    : PROJECT_OVERVIEW_SYSTEM_PROMPT;
  const glm5PromptAddon = isGlm5Model(modelName)
    ? [
        "",
        "Important for this model:",
        "- You must use exactly these top-level keys and no others: projectGoal, implementationNarrative, startupEntry, startupFlow, keyModules, executionFlow, flowDiagram, uncertainty.",
        "- Do not rename keys. Do not output alternative schemas such as project_identity, entry_points, core_modules, core_execution_path, model_architecture, reward_system, configuration, dependencies, or uncertainties.",
        "- `startupEntry` must be one object with exactly: file, summary, logic.",
        "- `startupFlow`, `keyModules`, and `executionFlow` must be arrays, not objects keyed by section name.",
        "- If evidence is incomplete, keep the required key and explain uncertainty inside `uncertainty` instead of inventing new fields.",
        "- Avoid placeholders like Unknown, Likely, Inferred unless the dossier truly lacks evidence. When uncertain, say why in `uncertainty`.",
        "- Prefer entry files that already appear in Entry candidates or sampled source files before making a weaker inference.",
        "- Prefer 4 to 6 execution steps that map to real code paths instead of broad thematic sections.",
        "- `keyModules` should name concrete files or modules, not abstract concepts.",
        "- Bad top-level shape example: {\"project_identity\": {...}, \"entry_points\": {...}}",
        "- Good top-level shape example: {\"projectGoal\":\"...\",\"implementationNarrative\":\"...\",\"startupEntry\":{\"file\":\"...\",\"summary\":\"...\",\"logic\":\"...\"},\"startupFlow\":[],\"keyModules\":[],\"executionFlow\":[],\"flowDiagram\":\"\",\"uncertainty\":\"...\"}",
        "",
        "Reference output style example:",
        "{",
        '  "projectGoal": "Train and serve a compact language model with pretraining, supervised tuning, and RL workflows.",',
        '  "implementationNarrative": "The repository centers model definition in model/model_minimind.py, keeps task-specific training entry scripts in trainer/, and uses shared helpers for initialization, checkpoints, and distributed setup. Runtime behavior is driven by concrete train_*.py scripts rather than by utility modules alone.",',
        '  "startupEntry": {',
        '    "file": "trainer/train_grpo.py",',
        '    "summary": "Training entry script that parses config, initializes models, and starts the GRPO loop.",',
        '    "logic": "This is treated as the entry because it is an executable train_*.py script that wires together dataset loading, model setup, reward computation, and the main optimization loop."',
        "  },",
        '  "startupFlow": [{"title":"Environment setup","file":"trainer/train_grpo.py","summary":"Initialize distributed state and runtime config.","details":"Set device, distributed backend, seeds, and parsed arguments before model creation."}],',
        '  "keyModules": [{"name":"train_grpo.py","file":"trainer/train_grpo.py","responsibility":"Owns the GRPO training loop, generation, reward computation, and optimization steps."}],',
        '  "executionFlow": [{"id":"prompt_batch","title":"Load prompt batch","file":"trainer/train_grpo.py","summary":"Read prompts from the training dataloader.","next":["generate_completion"]},{"id":"generate_completion","title":"Generate completions","file":"trainer/train_grpo.py","summary":"Call model.generate to produce candidate responses for each prompt.","next":["score_rewards"]}],',
        '  "flowDiagram": "flowchart TD\\nprompt_batch --> generate_completion\\ngenerate_completion --> score_rewards",',
        '  "uncertainty": "Based on sampled files only; if the exact training entry file is absent from the dossier, prefer the strongest visible train_*.py candidate and explain the gap here."',
        "}"
      ].join("\n")
    : "";

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
    "Do not add any prose before or after the JSON object.",
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
    glm5PromptAddon,
    "",
    "JSON schema:",
    outputSchema,
    "",
    "Grounding dossier:",
    dossierSections
  ].join("\n");

  return {
    systemInstruction,
    userPrompt
  };
}

function isGlm5Model(modelName: string): boolean {
  return /^glm-?5\b/i.test(modelName);
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
  const normalized = normalizeIncomingOverviewShape(parsed);

  return sanitizeGeneratedProjectOverview({
    schemaVersion: 1,
    workspaceId: metadata.workspaceId,
    sourceRevision: metadata.revision,
    generatedAt: metadata.generatedAt,
    language: fallbackLanguage,
    projectGoal: readString(normalized.projectGoal),
    implementationNarrative: readString(normalized.implementationNarrative),
    startupEntry: normalizeStartupEntry(normalized.startupEntry),
    startupFlow: readArray(normalized.startupFlow, normalizeStartupStep).slice(0, 8),
    keyModules: readArray(normalized.keyModules, normalizeKeyModule).slice(0, 8),
    executionFlow: normalizeExecutionFlow(normalized.executionFlow).slice(0, 8),
    flowDiagram: readString(normalized.flowDiagram),
    uncertainty: readString(normalized.uncertainty),
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
    title: readString(record.title) || readString(record.action) || readString(record.description),
    file: readString(record.file),
    summary: readString(record.summary) || readString(record.description) || readString(record.behavior),
    details:
      readString(record.details) ||
      joinNonEmpty(
        [
          readString(record.symbol),
          readString(record.lines),
          readString(record.behavior),
          readString(record.code_path)
        ],
        " | "
      )
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
      id: readIdentifier(record.id) || `step-${readString(record.step) || "node"}`,
      title: readString(record.title) || readString(record.action) || readString(record.description),
      file: readString(record.file),
      summary:
        readString(record.summary) ||
        readString(record.behavior) ||
        readString(record.code_path),
      next: readArray(record.next, (nextItem) => readIdentifier(nextItem)).filter(Boolean)
    };
  }).filter((node) => node.id && node.title);
}

function normalizeIncomingOverviewShape(
  parsed: Record<string, unknown>
): Record<string, unknown> {
  if (hasExpectedOverviewKeys(parsed)) {
    return parsed;
  }

  const projectIdentity = isRecord(parsed.project_identity) ? parsed.project_identity : {};
  const entryPoints = normalizeEntryPoints(parsed.entry_points);
  const primaryEntry = entryPoints[0];
  const altExecutionFlow = normalizeExecutionFlowItems(parsed.execution_flow);
  const altKeyModules = normalizeCoreModules(parsed.key_modules ?? parsed.core_modules);
  const uncertaintyItems = readArray(parsed.uncertainties, (item) => readString(item)).filter(Boolean);

  return {
    projectGoal:
      readString(parsed.projectGoal) ||
      readString(parsed.project_goal) ||
      readString(projectIdentity.primary_goal) ||
      joinNonEmpty([readString(projectIdentity.name), readString(projectIdentity.type)], " - ") ||
      joinNonEmpty([readString(parsed.project_name), readString(parsed.project_type)], " - "),
    implementationNarrative:
      readString(parsed.implementationNarrative) ||
      readString(parsed.architecture_summary) ||
      joinNonEmpty(
        flattenRecordStrings(parsed.inferred_architecture),
        " "
      ),
    startupEntry:
      parsed.startupEntry ||
      (primaryEntry
        ? {
            file: readString(primaryEntry.file) || readString(primaryEntry.path),
            summary:
              readString(primaryEntry.purpose) ||
              readString(primaryEntry.description) ||
              readString(parsed.project_type),
            logic:
              readString(primaryEntry.status) ||
              readString(primaryEntry.uncertainty) ||
              readString(parsed.architecture_summary)
          }
        : {}),
    startupFlow:
      parsed.startupFlow ||
      altExecutionFlow.slice(0, 3).map((item) => ({
        title:
          readString(item.title) ||
          readString(item.action) ||
          readString(item.description) ||
          readString(item.symbol) ||
          readString(item.file),
        file: readString(item.file),
        summary:
          readString(item.summary) ||
          readString(item.description) ||
          readString(item.behavior),
        details:
          joinNonEmpty(
            [
              readString(item.symbol),
              joinArray(readArray(item.symbols, (value) => readString(value)).filter(Boolean), ", "),
              readString(item.lines),
              readString(item.behavior),
              readString(item.code_path)
            ],
            " | "
          ) || readString(item.code_path)
      })),
    keyModules:
      parsed.keyModules ||
      altKeyModules.map((item) => ({
        name:
          readString(item.name) ||
          readString(item.class) ||
          readString(item.function) ||
          readString(item.symbol),
        file: readString(item.file),
        responsibility:
          joinNonEmpty(
            [
              readString(item.purpose),
              readString(item.logic),
              readString(item.implementation)
            ],
            " "
          ) || stringifyCompactRecord(item)
      })),
    executionFlow: parsed.executionFlow || altExecutionFlow,
    flowDiagram: readString(parsed.flowDiagram),
    uncertainty:
      readString(parsed.uncertainty) ||
      joinArray(uncertaintyItems, " "),
    dataFlow: parsed.data_flow
  };
}

function hasExpectedOverviewKeys(value: Record<string, unknown>): boolean {
  return [
    "projectGoal",
    "implementationNarrative",
    "startupEntry",
    "startupFlow",
    "keyModules",
    "executionFlow",
    "flowDiagram",
    "uncertainty"
  ].some((key) => key in value);
}

function normalizeEntryPoints(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (isRecord(value)) {
    const entries: Record<string, unknown>[] = [];

    if (typeof value.primary === "string") {
      entries.push({
        file: value.primary
      });
    } else if (isRecord(value.primary)) {
      entries.push(value.primary);
    }

    if (isRecord(value.inferred_from_context)) {
      entries.push(value.inferred_from_context);
    }

    if (typeof value.uncertainty === "string" && entries[0]) {
      entries[0] = {
        ...entries[0],
        uncertainty: value.uncertainty
      };
    }

    return entries;
  }

  return [];
}

function normalizeExecutionFlowItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (isRecord(value)) {
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) {
        const items = nested.filter(isRecord);
        if (items.length > 0) {
          return items;
        }
      }
    }
  }

  return [];
}

function normalizeCoreModules(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (isRecord(value)) {
    const modules: Record<string, unknown>[] = [];
    for (const [name, item] of Object.entries(value)) {
      if (!isRecord(item)) {
        continue;
      }

      modules.push({
        name,
        ...item
      });
    }

    return modules;
  }

  return [];
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

function joinArray(values: readonly string[], separator: string): string {
  return values.filter(Boolean).join(separator).trim();
}

function joinNonEmpty(values: readonly string[], separator: string): string {
  return joinArray(values.filter((value) => value.trim().length > 0), separator);
}

function stringifyCompactRecord(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function flattenRecordStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRecordStrings(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => flattenRecordStrings(item));
  }

  return [];
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
