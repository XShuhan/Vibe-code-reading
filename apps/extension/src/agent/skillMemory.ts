import type { StructuredThreadAnswer, Thread, ThreadQuestionType } from "@code-vibe/shared";

interface LearnedSkill {
  id: string;
  questionType: ThreadQuestionType;
  instruction: string;
  sourceThreadId: string;
}

const MAX_SKILLS_PER_TYPE = 3;

export class SkillMemoryBank {
  private readonly skillsByType = new Map<ThreadQuestionType, LearnedSkill[]>();

  hydrate(threads: Thread[]): void {
    this.skillsByType.clear();

    for (const thread of threads) {
      const answer = thread.messages.findLast((message) => message.role === "assistant")?.structuredAnswer;
      if (!answer || !isPromotableAnswer(answer)) {
        continue;
      }

      this.addSkill({
        id: `${thread.id}:${answer.questionType}`,
        questionType: answer.questionType,
        instruction: distillInstruction(answer),
        sourceThreadId: thread.id
      });
    }
  }

  record(threadId: string, answer: StructuredThreadAnswer | undefined): void {
    if (!answer || !isPromotableAnswer(answer)) {
      return;
    }

    this.addSkill({
      id: `${threadId}:${answer.questionType}:${Date.now()}`,
      questionType: answer.questionType,
      instruction: distillInstruction(answer),
      sourceThreadId: threadId
    });
  }

  getInstructions(questionType: ThreadQuestionType): string[] {
    const entries = this.skillsByType.get(questionType) ?? [];
    return entries.map((entry) => entry.instruction);
  }

  private addSkill(skill: LearnedSkill): void {
    const current = this.skillsByType.get(skill.questionType) ?? [];
    if (current.some((entry) => entry.instruction === skill.instruction)) {
      return;
    }

    const next = [skill, ...current]
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, MAX_SKILLS_PER_TYPE);
    this.skillsByType.set(skill.questionType, next);
  }
}

function isPromotableAnswer(answer: StructuredThreadAnswer): boolean {
  return (
    answer.conclusion.trim().length > 24 &&
    answer.codeBehavior.trim().length > 80 &&
    !/not enough grounded evidence/i.test(answer.conclusion)
  );
}

function distillInstruction(answer: StructuredThreadAnswer): string {
  const hints: string[] = [];

  if (containsStepStyle(answer.codeBehavior)) {
    hints.push("Describe code behavior in ordered steps.");
  }
  if (answer.callFlow.includes("->")) {
    hints.push("Represent call flow as an arrow chain from entry to sink.");
  }
  if (answer.risks.length > 0) {
    hints.push("Name concrete risk with condition and impact.");
  }
  if (answer.principle.length > 0) {
    hints.push("Explain why the design works before discussing edge cases.");
  }

  if (hints.length === 0) {
    hints.push("Keep answer concrete, evidence-grounded, and logically ordered.");
  }

  return hints.join(" ");
}

function containsStepStyle(text: string): boolean {
  return /(?:^|\s)(?:\d+[.)]|first|second|third|then)\s/i.test(text);
}

