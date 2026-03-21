import type {
  EvidenceSpan,
  GroundedAnswer,
  ModelChunk,
  ModelConfig,
  ModelInfo,
  ModelRequest,
  ModelResponse,
  QuestionContext,
  StructuredThreadAnswer
} from "@code-vibe/shared";

import { groundedExplainPrompt } from "./prompt/groundedExplainPrompt";
import { MockAdapter } from "./adapters/mockAdapter";
import { OpenAICompatibleAdapter } from "./adapters/openAICompatible";

export interface ModelAdapter {
  listModels(): Promise<ModelInfo[]>;
  streamChat(request: ModelRequest): AsyncIterable<ModelChunk>;
  completeChat(request: ModelRequest): Promise<ModelResponse>;
  supportsVision(model?: string): boolean;
  supportsToolCalling(model?: string): boolean;
  supportsReasoning(model?: string): boolean;
}

export type GroundedStreamEvent =
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "done";
      answer: GroundedAnswer;
    };

export function createModelAdapter(config: ModelConfig): ModelAdapter {
  switch (config.provider) {
    case "mock":
      return new MockAdapter();
    case "openai-compatible":
    default:
      return new OpenAICompatibleAdapter(config);
  }
}

export async function answerGroundedQuestion(
  config: ModelConfig,
  ctx: QuestionContext,
  evidence: EvidenceSpan[],
  options?: {
    systemInstruction?: string;
    promptInstruction?: string;
    questionType?: StructuredThreadAnswer["questionType"];
    skillId?: StructuredThreadAnswer["skillId"];
    structuredOutput?: boolean;
  }
): Promise<GroundedAnswer> {
  const adapter = createModelAdapter(config);
  const request = buildRequest(config, ctx, evidence, options);
  const response = await adapter.completeChat(request);
  return buildGroundedAnswer(response.content, evidence, options);
}

export async function* streamGroundedQuestion(
  config: ModelConfig,
  ctx: QuestionContext,
  evidence: EvidenceSpan[],
  options?: {
    systemInstruction?: string;
    promptInstruction?: string;
    questionType?: StructuredThreadAnswer["questionType"];
    skillId?: StructuredThreadAnswer["skillId"];
    structuredOutput?: boolean;
  }
): AsyncIterable<GroundedStreamEvent> {
  const adapter = createModelAdapter(config);
  const request = buildRequest(config, ctx, evidence, options);

  let fullText = "";
  for await (const chunk of adapter.streamChat(request)) {
    if (!chunk.delta) {
      continue;
    }
    fullText += chunk.delta;
    yield {
      type: "delta",
      delta: chunk.delta
    };
  }

  yield {
    type: "done",
    answer: buildGroundedAnswer(fullText, evidence, options)
  };
}

export function parseStructuredAnswerSnapshot(params: {
  content: string;
  questionType?: StructuredThreadAnswer["questionType"];
  skillId?: StructuredThreadAnswer["skillId"];
  sourceReferences: string[];
}): StructuredThreadAnswer | undefined {
  return parseStructuredAnswer(
    params.content,
    params.questionType,
    params.skillId,
    params.sourceReferences.map((reference, index) => ({
      id: `snapshot_citation_${index + 1}`,
      path: "",
      startLine: 0,
      endLine: 0,
      label: reference
    }))
  );
}

export async function testModelConnection(
  config: ModelConfig
): Promise<{ model: string; content: string; availableModels: ModelInfo[] }> {
  const adapter = createModelAdapter(config);
  const availableModels = await adapter.listModels().catch(() => []);
  const model = config.model || availableModels[0]?.id || "mock-grounded";
  const response = await adapter.completeChat({
    model,
    temperature: 0,
    maxTokens: Math.min(config.maxTokens || 64, 64),
    messages: [
      {
        role: "system",
        content: "Reply with exactly OK."
      },
      {
        role: "user",
        content: "Reply with exactly OK."
      }
    ]
  });

  return {
    model,
    content: response.content,
    availableModels
  };
}

export async function generateThreadTitle(
  config: ModelConfig,
  input: {
    question: string;
    questionType?: StructuredThreadAnswer["questionType"];
    structuredAnswer?: StructuredThreadAnswer;
  }
): Promise<string | undefined> {
  if (config.provider === "mock") {
    return undefined;
  }

  const adapter = createModelAdapter(config);
  const response = await adapter.completeChat({
    model: config.model || "mock-grounded",
    temperature: 0,
    maxTokens: 32,
    messages: [
      {
        role: "system",
        content:
          "Generate a concise thread title for code-reading Q&A. Output plain text only, 4-10 words, no quotes."
      },
      {
        role: "user",
        content: [
          `Question type: ${input.questionType ?? "unknown"}`,
          `User question: ${input.question}`,
          `Conclusion: ${input.structuredAnswer?.conclusion ?? ""}`,
          `Section titles: ${(input.structuredAnswer?.sections ?? []).map((item) => item.title).join(", ")}`
        ].join("\n")
      }
    ]
  });

  const normalized = sanitizeTitle(response.content);
  return normalized || undefined;
}

function buildRequest(
  config: ModelConfig,
  ctx: QuestionContext,
  evidence: EvidenceSpan[],
  options?: {
    systemInstruction?: string;
    promptInstruction?: string;
  }
): ModelRequest {
  const prompt = groundedExplainPrompt(ctx, evidence, options?.promptInstruction);
  return {
    model: config.model || "mock-grounded",
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    messages: [
      {
        role: "system",
        content:
          options?.systemInstruction ??
          "Explain code using only the supplied evidence. Distinguish facts, inferences, and uncertainty."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
}

function buildGroundedAnswer(
  content: string,
  evidence: EvidenceSpan[],
  options?: {
    questionType?: StructuredThreadAnswer["questionType"];
    skillId?: StructuredThreadAnswer["skillId"];
    structuredOutput?: boolean;
  }
): GroundedAnswer {
  const citations = evidence.map((item, index) => ({
    id: `citation_${index + 1}`,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    symbolId: item.symbolId,
    label: `${item.path}:${item.startLine}-${item.endLine}`
  }));

  const uncertaintyFlags = evidence.length === 0 ? ["No evidence matched the question."] : [];

  const suggestedCards = evidence.slice(0, 2).map((item) => ({
    title: inferCardTitle(item.path),
    type: "ConceptCard" as const,
    summary: item.reason
  }));

  const structuredAnswer =
    options?.structuredOutput
      ? parseStructuredAnswer(content, options?.questionType, options?.skillId, citations)
      : undefined;

  const answerMarkdown = structuredAnswer
    ? formatStructuredAnswerMarkdown(structuredAnswer)
    : [
        content,
        "",
        "Source references",
        ...citations.map((citation, index) => `${index + 1}. ${citation.label}`)
      ].join("\n");

  return {
    answerMarkdown,
    structuredAnswer,
    citations,
    suggestedCards,
    uncertaintyFlags
  };
}

function inferCardTitle(filePath: string): string {
  const lastSegment = filePath.split("/").at(-1) ?? filePath;
  return lastSegment.replace(/\.[^.]+$/, "");
}

function sanitizeTitle(value: string): string {
  const singleLine = value
    .replace(/\r?\n/g, " ")
    .replace(/^[\s"'`#\-:]+|[\s"'`#\-:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!singleLine) {
    return "";
  }

  const limit = 54;
  if (singleLine.length <= limit) {
    return singleLine;
  }

  return `${singleLine.slice(0, limit - 3).trim()}...`;
}

function parseStructuredAnswer(
  content: string,
  questionType: StructuredThreadAnswer["questionType"] | undefined,
  skillId: StructuredThreadAnswer["skillId"] | undefined,
  citations: GroundedAnswer["citations"]
): StructuredThreadAnswer | undefined {
  const parsed = safeParseJsonObject(content);
  const partial = !parsed ? parsePartialStructuredObject(content) : null;
  const source = parsed ?? partial;
  if (!source) {
    return undefined;
  }

  return {
    questionType: questionType ?? "explain_code",
    skillId: skillId ?? "ExplainSkill",
    questionRestatement: readOptionalString(source.questionRestatement),
    conclusion: readOptionalString(source.conclusion),
    codeBehavior: readOptionalString(source.codeBehavior),
    principle: readOptionalString(source.principle),
    callFlow: readOptionalString(source.callFlow),
    risks: readOptionalString(source.risks),
    uncertainty: readOptionalString(source.uncertainty),
    sourceReferences: citations.map((citation) => citation.label),
    sections: readSections(source.sections),
    extraSections: readSections(source.extraSections)
  };
}

function safeParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = parseJsonCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!blockMatch) {
    return null;
  }

  return parseJsonCandidate(blockMatch[1]);
}

function parseJsonCandidate(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(input);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parsePartialStructuredObject(content: string): Record<string, unknown> | null {
  if (!content.includes("\"questionRestatement\"") && !content.includes("\"sections\"")) {
    return null;
  }

  const partial: Record<string, unknown> = {
    questionRestatement: readPartialStringField(content, "questionRestatement"),
    conclusion: readPartialStringField(content, "conclusion"),
    codeBehavior: readPartialStringField(content, "codeBehavior"),
    principle: readPartialStringField(content, "principle"),
    callFlow: readPartialStringField(content, "callFlow"),
    risks: readPartialStringField(content, "risks"),
    uncertainty: readPartialStringField(content, "uncertainty"),
    sections: readPartialSections(content),
    extraSections: readPartialSections(content, "extraSections")
  };

  const hasAnyText =
    Object.values(partial).some((value) => typeof value === "string" && value.trim().length > 0) ||
    (Array.isArray(partial.sections) && partial.sections.length > 0) ||
    (Array.isArray(partial.extraSections) && partial.extraSections.length > 0);

  return hasAnyText ? partial : null;
}

function readPartialStringField(content: string, field: string): string {
  const keyIndex = content.indexOf(`"${field}"`);
  if (keyIndex < 0) {
    return "";
  }

  const colonIndex = content.indexOf(":", keyIndex);
  if (colonIndex < 0) {
    return "";
  }

  const quoteStart = content.indexOf("\"", colonIndex);
  if (quoteStart < 0) {
    return "";
  }

  let escaped = false;
  let value = "";
  for (let index = quoteStart + 1; index < content.length; index += 1) {
    const char = content[index] ?? "";
    if (escaped) {
      value += decodeEscapedChar(char);
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      break;
    }

    value += char;
  }

  return value.trim();
}

function readPartialSections(content: string, key = "sections"): Array<{ title: string; content: string }> {
  const keyIndex = content.indexOf(`"${key}"`);
  if (keyIndex < 0) {
    return [];
  }

  const tail = content.slice(keyIndex);
  const titles = [...tail.matchAll(/"title"\s*:\s*"([^"]*)/g)].map((match) => decodeEscapedText(match[1] ?? ""));
  const bodies = [...tail.matchAll(/"content"\s*:\s*"([^"]*)/g)].map((match) => decodeEscapedText(match[1] ?? ""));
  const count = Math.min(titles.length, bodies.length);

  const sections: Array<{ title: string; content: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const title = titles[index]?.trim() ?? "";
    const body = bodies[index]?.trim() ?? "";
    if (!title || !body) {
      continue;
    }
    sections.push({ title, content: body });
  }

  return sections;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEscapedChar(value: string): string {
  switch (value) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "\"":
      return "\"";
    case "\\":
      return "\\";
    default:
      return value;
  }
}

function decodeEscapedText(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\\"", "\"")
    .replaceAll("\\\\", "\\");
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSections(value: unknown): StructuredThreadAnswer["extraSections"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sections: Array<{ title: string; content: string }> = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!title || !content) {
      continue;
    }
    sections.push({ title, content });
  }

  return sections;
}

function formatStructuredAnswerMarkdown(answer: StructuredThreadAnswer): string {
  const primarySections =
    answer.sections && answer.sections.length > 0
      ? answer.sections
      : [];

  const fallbackSections = [
    ["What the code is doing", answer.codeBehavior],
    ["Why / principle", answer.principle],
    ["Call flow / upstream-downstream", answer.callFlow],
    ["Risks / uncertainties", [answer.risks, answer.uncertainty].filter(Boolean).join("\n")]
  ].filter((entry) => entry[1].trim().length > 0);

  const finalSections =
    primarySections.length > 0
      ? primarySections.map((section) => [section.title, section.content] as const)
      : [
          ...fallbackSections,
          ...((answer.extraSections ?? []).map((section) => [section.title, section.content] as const))
        ].filter((entry) => entry[1].trim().length > 0);

  return [
    ...(answer.questionRestatement ? ["Question restatement", answer.questionRestatement, ""] : []),
    ...(answer.conclusion ? ["Conclusion first", answer.conclusion, ""] : []),
    ...finalSections.flatMap((entry) => [entry[0], entry[1], ""]),
    "",
    "Source references",
    ...answer.sourceReferences.map((reference, index) => `${index + 1}. ${reference}`)
  ].join("\n");
}
