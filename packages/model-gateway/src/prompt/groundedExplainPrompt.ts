import type { EvidenceSpan, QuestionContext } from "@code-vibe/shared";

export function groundedExplainPrompt(
  ctx: QuestionContext,
  evidence: EvidenceSpan[],
  promptInstruction?: string
): string {
  const evidenceList = evidence
    .map(
      (item, index) =>
        [
          `Evidence ${index + 1}`,
          `Path: ${item.path}:${item.startLine}-${item.endLine}`,
          `Reason: ${item.reason}`,
          item.excerpt
        ].join("\n")
    )
    .join("\n\n");

  return [
    "You are a grounded code comprehension assistant.",
    "Use only the supplied evidence spans.",
    "Distinguish observed facts, reasonable inferences, and uncertainty.",
    "Cite source locations in prose when possible.",
    "",
    `Question: ${ctx.userQuestion}`,
    `Active file: ${ctx.activeFile}`,
    ctx.activeSelection
      ? `Selection: ${ctx.activeSelection.startLine}-${ctx.activeSelection.endLine}\n${ctx.activeSelection.text}`
      : "Selection: none",
    "",
    evidenceList,
    promptInstruction ? `\nAdditional instructions:\n${promptInstruction}` : ""
  ].join("\n");
}

