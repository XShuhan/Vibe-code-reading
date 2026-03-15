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
}

export interface QuestionOrchestratorOutput {
  questionType: ThreadQuestionType;
  skillId: StructuredThreadAnswer["skillId"];
  systemInstruction: string;
  promptInstruction: string;
  prioritizedEvidence: EvidenceSpan[];
}

export function orchestrateQuestion(input: QuestionOrchestratorInput): QuestionOrchestratorOutput {
  const questionType = classifyQuestionType(input.question);
  const skill = AGENT_SKILLS[questionType];

  const systemInstruction = [
    AGENT_SOUL_SYSTEM_PROMPT,
    `Current skill: ${skill.id}.`,
    `Skill focus: ${skill.focus}`
  ].join(" ");

  const promptInstruction = [
    "Respond with a strict JSON object only. Do not include markdown fences.",
    "JSON schema:",
    "{",
    '  "questionRestatement": "string",',
    '  "conclusion": "string",',
    '  "codeBehavior": "string",',
    '  "principle": "string",',
    '  "callFlow": "string",',
    '  "risks": "string",',
    '  "uncertainty": "string"',
    "}",
    "Write each field with concrete, evidence-grounded statements.",
    `Question type: ${questionType}.`,
    `Selection range: ${input.editorState.activeFile}:${input.editorState.startLine}-${input.editorState.endLine}.`,
    `Active symbol: ${input.context.activeSymbolId ?? "unknown"}.`,
    `Evidence strategy: ${skill.evidenceHint}`,
    `Output style: ${skill.outputHint}`
  ].join("\n");

  return {
    questionType,
    skillId: skill.id,
    systemInstruction,
    promptInstruction,
    prioritizedEvidence: prioritizeEvidenceForSkill(input.evidence, questionType)
  };
}

