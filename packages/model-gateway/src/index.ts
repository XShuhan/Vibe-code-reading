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
  const prompt = groundedExplainPrompt(ctx, evidence, options?.promptInstruction);

  const response = await adapter.completeChat({
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
  });

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
      ? parseStructuredAnswer(response.content, options?.questionType, options?.skillId, citations)
      : undefined;

  const answerMarkdown = structuredAnswer
    ? formatStructuredAnswerMarkdown(structuredAnswer)
    : [
        response.content,
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

function inferCardTitle(filePath: string): string {
  const lastSegment = filePath.split("/").at(-1) ?? filePath;
  return lastSegment.replace(/\.[^.]+$/, "");
}

function parseStructuredAnswer(
  content: string,
  questionType: StructuredThreadAnswer["questionType"] | undefined,
  skillId: StructuredThreadAnswer["skillId"] | undefined,
  citations: GroundedAnswer["citations"]
): StructuredThreadAnswer | undefined {
  const parsed = safeParseJsonObject(content);
  if (!parsed) {
    return undefined;
  }

  return {
    questionType: questionType ?? "explain_code",
    skillId: skillId ?? "ExplainSkill",
    questionRestatement: readString(parsed.questionRestatement),
    conclusion: readString(parsed.conclusion),
    codeBehavior: readString(parsed.codeBehavior),
    principle: readString(parsed.principle),
    callFlow: readString(parsed.callFlow),
    risks: readString(parsed.risks),
    uncertainty: readString(parsed.uncertainty),
    sourceReferences: citations.map((citation) => citation.label)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Not enough grounded evidence.";
}

function formatStructuredAnswerMarkdown(answer: StructuredThreadAnswer): string {
  return [
    "Question restatement",
    answer.questionRestatement,
    "",
    "Conclusion first",
    answer.conclusion,
    "",
    "What the code is doing",
    answer.codeBehavior,
    "",
    "Why / principle",
    answer.principle,
    "",
    "Call flow / upstream-downstream",
    answer.callFlow,
    "",
    "Risks / uncertainties",
    [answer.risks, answer.uncertainty].filter(Boolean).join("\n"),
    "",
    "Source references",
    ...answer.sourceReferences.map((reference, index) => `${index + 1}. ${reference}`)
  ].join("\n");
}
