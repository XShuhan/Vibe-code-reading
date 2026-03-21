import type {
  ModelChunk,
  ModelInfo,
  ModelRequest,
  ModelResponse
} from "@code-vibe/shared";

import type { ModelAdapter } from "../index";

export class MockAdapter implements ModelAdapter {
  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mock-grounded", label: "Mock Grounded Model" }];
  }

  async *streamChat(request: ModelRequest): AsyncIterable<ModelChunk> {
    const response = await this.completeChat(request);
    const chunks = response.content.match(/.{1,120}/g) ?? [response.content];
    for (const chunk of chunks) {
      yield { delta: chunk };
    }
    yield { delta: "", done: true };
  }

  async completeChat(request: ModelRequest): Promise<ModelResponse> {
    const userMessage = request.messages[request.messages.length - 1]?.content ?? "";
    const evidenceMentions = [...userMessage.matchAll(/Path: (.+?):(\d+-\d+)/g)]
      .slice(0, 4)
      .map((match) => `${match[1]}:${match[2]}`);

    const content = [
      "Observed facts",
      evidenceMentions.length > 0
        ? `- The answer is grounded in ${evidenceMentions.join(", ")}.`
        : "- The answer is grounded in the supplied evidence set.",
      "",
      "Inference",
      "- This mock response is intended for local development when no remote model is configured.",
      "",
      "Uncertainty",
      "- Confirm behavior against the cited code before treating it as complete."
    ].join("\n");

    return { content };
  }

  supportsVision(): boolean {
    return false;
  }

  supportsToolCalling(): boolean {
    return false;
  }

  supportsReasoning(): boolean {
    return false;
  }
}

