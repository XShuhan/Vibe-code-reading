import type { EvidenceSpan, ThreadQuestionType, ThreadSkillId } from "@code-vibe/shared";

export interface AgentSkillDefinition {
  id: ThreadSkillId;
  questionType: ThreadQuestionType;
  displayName: string;
  focus: string;
  evidenceHint: string;
  outputHint: string;
}

export const AGENT_SKILLS: Record<ThreadQuestionType, AgentSkillDefinition> = {
  explain_code: {
    id: "ExplainSkill",
    questionType: "explain_code",
    displayName: "Explain Code",
    focus: "Describe what this code does step by step and what each key branch changes.",
    evidenceHint: "Prioritize active symbol + nearby evidence.",
    outputHint: "Make behavior reconstruction concrete and avoid vague wording."
  },
  call_flow: {
    id: "CallFlowSkill",
    questionType: "call_flow",
    displayName: "Call Flow",
    focus: "Explain callers, callees, and data/control handoff points.",
    evidenceHint: "Prioritize evidence with call/import reasons and connected symbols.",
    outputHint: "Explicitly mark upstream and downstream."
  },
  principle: {
    id: "PrincipleSkill",
    questionType: "principle",
    displayName: "Principle",
    focus: "Explain implementation choices, tradeoffs, and mechanism-level principles.",
    evidenceHint: "Keep algorithmic or policy-oriented evidence first.",
    outputHint: "Use cause-effect language for why this design works."
  },
  risk_review: {
    id: "RiskReviewSkill",
    questionType: "risk_review",
    displayName: "Risk Review",
    focus: "Identify concrete bugs, edge cases, and maintenance risks.",
    evidenceHint: "Prioritize branching, error handling, and boundary-related evidence.",
    outputHint: "Rank risks by impact and likelihood where possible."
  },
  module_summary: {
    id: "ModuleSummarySkill",
    questionType: "module_summary",
    displayName: "Module Summary",
    focus: "Summarize module responsibilities, boundaries, and public surface.",
    evidenceHint: "Prioritize export definitions, interfaces, and related files.",
    outputHint: "Make ownership boundaries and responsibilities explicit."
  }
};

export function prioritizeEvidenceForSkill(
  evidence: EvidenceSpan[],
  questionType: ThreadQuestionType
): EvidenceSpan[] {
  const weighted = evidence.map((item, index) => {
    const reason = item.reason.toLowerCase();
    const path = item.path.toLowerCase();
    let bonus = 0;

    if (questionType === "call_flow") {
      if (reason.includes("call") || reason.includes("graph")) {
        bonus += 4;
      }
      if (reason.includes("active symbol")) {
        bonus += 2;
      }
    } else if (questionType === "risk_review") {
      if (item.excerpt.includes("throw") || item.excerpt.includes("catch")) {
        bonus += 3;
      }
      if (item.excerpt.includes("if") || item.excerpt.includes("undefined")) {
        bonus += 2;
      }
    } else if (questionType === "module_summary") {
      if (item.excerpt.includes("export ") || path.includes("index.")) {
        bonus += 3;
      }
    } else if (questionType === "principle") {
      if (item.excerpt.includes("return") || item.excerpt.includes("new ")) {
        bonus += 2;
      }
    } else if (questionType === "explain_code") {
      if (reason.includes("active")) {
        bonus += 2;
      }
    }

    return {
      item,
      score: item.score + bonus,
      index
    };
  });

  return weighted
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

