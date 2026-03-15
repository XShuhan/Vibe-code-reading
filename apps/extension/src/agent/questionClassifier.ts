import type { ThreadQuestionType } from "@code-vibe/shared";

const QUESTION_PATTERNS: Array<{ type: ThreadQuestionType; keywords: string[] }> = [
  {
    type: "call_flow",
    keywords: ["调用链", "谁调用", "where called", "call flow", "caller", "callee", "上下游", "upstream", "downstream"]
  },
  {
    type: "risk_review",
    keywords: ["风险", "bug", "问题", "隐患", "edge case", "漏洞", "缺陷", "review risk"]
  },
  {
    type: "module_summary",
    keywords: ["模块", "summary", "职责", "整体", "overview", "boundary", "边界"]
  },
  {
    type: "principle",
    keywords: ["原理", "为什么", "机制", "design", "tradeoff", "how it works", "实现思路"]
  },
  {
    type: "explain_code",
    keywords: ["解释", "explain", "what does", "做什么", "看懂", "行为"]
  }
];

export function classifyQuestionType(question: string): ThreadQuestionType {
  const normalized = question.trim().toLowerCase();

  for (const candidate of QUESTION_PATTERNS) {
    if (candidate.keywords.some((keyword) => normalized.includes(keyword))) {
      return candidate.type;
    }
  }

  return "explain_code";
}

