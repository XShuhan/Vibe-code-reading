import type {
  EditorSelectionState,
  EvidenceSpan,
  QuestionContext,
  StructuredThreadAnswer,
  ThreadQuestionType
} from "@code-vibe/shared";

import { classifyQuestionType } from "./questionClassifier";
import { AGENT_SKILLS, prioritizeEvidenceForSkill } from "./skills";
import { AGENT_SOUL_SYSTEM_PROMPT } from "./soul";

export interface QuestionOrchestratorInput {
  question: string;
  editorState: EditorSelectionState;
  context: QuestionContext;
  evidence: EvidenceSpan[];
  forcedQuestionType?: ThreadQuestionType;
  learnedSkillInstructions?: string[];
}

export interface QuestionOrchestratorOutput {
  questionType: ThreadQuestionType;
  skillId: StructuredThreadAnswer["skillId"];
  systemInstruction: string;
  promptInstruction: string;
  prioritizedEvidence: EvidenceSpan[];
  requestedSections: string[];
  focusMode: "full" | "focused";
  summaryMode: boolean;
}

export function orchestrateQuestion(input: QuestionOrchestratorInput): QuestionOrchestratorOutput {
  const questionType = input.forcedQuestionType ?? classifyQuestionType(input.question);
  const skill = AGENT_SKILLS[questionType];
  const requestedSections = detectRequestedSections(input.question);
  const focusMode = shouldUseFocusedMode(input.question) ? "focused" : "full";
  const summaryMode = shouldUseSummaryMode(input.question, questionType);
  const learnedSkills = focusMode === "focused" ? [] : (input.learnedSkillInstructions ?? []);

  const systemInstruction = [
    AGENT_SOUL_SYSTEM_PROMPT,
    `Current skill: ${skill.id}.`,
    `Skill focus: ${skill.focus}`,
    learnedSkills.length > 0
      ? `Apply learned style skills: ${learnedSkills.join(" ")}`
      : "Apply default style skills."
  ].join(" ");
  const schemaLines = summaryMode
    ? [
        '{',
        '  "questionRestatement": "string",',
        '  "conclusion": "string",',
        '  "sections": [{"title":"string","content":"string"}],',
        '  "extraSections": [{"title":"string","content":"string"}]',
        '}'
      ]
    : [
        '{',
        '  "sections": [{"title":"string","content":"string"}],',
        '  "questionRestatement": "string (optional, can be empty)",',
        '  "conclusion": "string (optional, can be empty)",',
        '  "extraSections": [{"title":"string","content":"string"}]',
        '}'
      ];
  const promptInstruction = [
    "Respond with a strict JSON object only. Do not include markdown fences.",
    "JSON schema:",
    ...schemaLines,
    "The `sections` array is primary. Include only sections directly useful for the user question (usually 2-4 sections).",
    "Avoid generic headings unless user asked for broad explanation.",
    "Write each field with concrete, evidence-grounded statements.",
    `Question type: ${questionType}.`,
    `Selection range: ${input.editorState.activeFile}:${input.editorState.startLine}-${input.editorState.endLine}.`,
    `Active symbol: ${input.context.activeSymbolId ?? "unknown"}.`,
    `Evidence strategy: ${skill.evidenceHint}`,
    `Output style: ${skill.outputHint}`,
    learnedSkills.length > 0
      ? `Learned skills:\n${learnedSkills.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "Learned skills: none yet.",
    focusMode === "focused"
      ? "Focused mode: prioritize only sections directly requested by user. Non-relevant base sections can be empty strings."
      : "Full mode: provide complete analysis across all base sections.",
    summaryMode
      ? "Summary mode: include concise question restatement + conclusion."
      : "Normal mode: keep questionRestatement/conclusion empty unless user explicitly asks for summary."
  ].join("\n");
  const dynamicPrompt = requestedSections.length > 0
    ? `Add these extra sections because the user explicitly asked for them:\n${requestedSections.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : "No extra sections requested by user.";
  const strictFocusPrompt =
    focusMode === "focused" && requestedSections.length > 0
      ? `Focused strictness: sections MUST stay within requested section titles only: ${requestedSections.join(", ")}.`
      : "Focused strictness: not applied.";

  return {
    questionType,
    skillId: skill.id,
    systemInstruction,
    promptInstruction: `${promptInstruction}\n${dynamicPrompt}\n${strictFocusPrompt}`,
    prioritizedEvidence: prioritizeEvidenceForSkill(input.evidence, questionType),
    requestedSections,
    focusMode,
    summaryMode
  };
}

function detectRequestedSections(question: string): string[] {
  const text = question.toLowerCase();
  const sections: string[] = [];

  if (/(input|output|io|输入|输出|入参|返回值|参数)/i.test(text)) {
    sections.push("Input / Output");
  }
  if (/(pseudocode|pseudo-code|伪代码|流程代码|简化代码)/i.test(text)) {
    sections.push("Simplified Pseudocode");
  }
  if (/(performance|复杂度|性能|效率|耗时|memory|内存)/i.test(text)) {
    sections.push("Performance Considerations");
  }
  if (/(并发|线程|锁|async|await|race|竞态)/i.test(text)) {
    sections.push("Concurrency / State");
  }
  if (/(test|测试|用例|mock|验证)/i.test(text)) {
    sections.push("Testing Notes");
  }
  if (/(refactor|重构|改进|优化建议)/i.test(text)) {
    sections.push("Refactor Suggestions");
  }

  return sections;
}

function shouldUseFocusedMode(question: string): boolean {
  return /(pseudocode|pseudo-code|伪代码|只要|just|only|只需要|仅需)/i.test(question.toLowerCase());
}

function shouldUseSummaryMode(question: string, questionType: ThreadQuestionType): boolean {
  if (questionType === "module_summary") {
    return true;
  }
  return /(总结|归纳|summary|summarize|tl;dr|tldr)/i.test(question.toLowerCase());
}
