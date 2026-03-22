import type {
  ChatMessage,
  ModelChunk,
  ModelConfig,
  ModelInfo,
  ModelRequest,
  ModelResponse
} from "@code-vibe/shared";

import type { ModelAdapter } from "../index";

export class OpenAICompatibleAdapter implements ModelAdapter {
  constructor(private readonly config: ModelConfig) {}

  async listModels(): Promise<ModelInfo[]> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      return [];
    }

    const response = await fetch(joinUrl(this.config.baseUrl, "/models"), {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ id: string }>;
    };

    return (payload.data ?? []).map((model) => ({
      id: model.id,
      label: model.id
    }));
  }

  async *streamChat(request: ModelRequest): AsyncIterable<ModelChunk> {
    assertConfigured(this.config);

    const payload = {
      model: request.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true
    };

    let response: Response;
    try {
      response = await fetchWithRetry(
        () =>
          fetch(joinUrl(this.config.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(payload)
          }),
        {
          maxRetries: 3,
          initialDelayMs: 700
        }
      );
    } catch {
      // Some providers fail on stream=true; gracefully downgrade to non-stream mode.
      const fallback = await this.completeChat(request);
      yield { delta: fallback.content, done: true };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const detail = errorText.trim();
      throw new Error(
        `Model request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`
      );
    }

    if (!response.body) {
      const fallback = await this.completeChat(request);
      yield { delta: fallback.content, done: true };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) {
          continue;
        }

        const data = line.slice("data:".length).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          const payloadChunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
            }>;
          };
          const delta = payloadChunk.choices?.[0]?.delta?.content;
          if (delta) {
            yield { delta };
          }
        } catch {
          // Ignore malformed event chunks and continue streaming.
        }
      }
    }

    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const data = tail.slice("data:".length).trim();
      if (data && data !== "[DONE]") {
        try {
          const payloadChunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
            }>;
          };
          const delta = payloadChunk.choices?.[0]?.delta?.content;
          if (delta) {
            yield { delta };
          }
        } catch {
          // Ignore malformed tail chunk.
        }
      }
    }

    yield { delta: "", done: true };
  }

  async completeChat(request: ModelRequest): Promise<ModelResponse> {
    assertConfigured(this.config);

    const payload = buildCompletionPayload(request);

    let response: Response;
    try {
      response = await fetchWithRetry(
        () =>
          fetch(joinUrl(this.config.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(payload)
          }),
        {
          maxRetries: 3,
          initialDelayMs: 700
        }
      );
    } catch (error) {
      throw toNetworkError(this.config.baseUrl, error);
    }

    if (!response.ok && request.responseFormat) {
      const fallbackPayload = buildCompletionPayload({
        ...request,
        responseFormat: undefined
      });
      response = await fetchWithRetry(
        () =>
          fetch(joinUrl(this.config.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(fallbackPayload)
          }),
        {
          maxRetries: 3,
          initialDelayMs: 700
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      const detail = errorText.trim();
      throw new Error(
        `Model request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model response did not contain assistant content.");
    }

    return { content };
  }

  supportsVision(): boolean {
    return false;
  }

  supportsToolCalling(): boolean {
    return false;
  }

  supportsReasoning(): boolean {
    return true;
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${suffix}`;
}

function buildCompletionPayload(request: ModelRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    temperature: request.temperature,
    max_tokens: request.maxTokens
  };

  if (request.responseFormat?.type === "json_object") {
    payload.response_format = {
      type: "json_object"
    };
  } else if (request.responseFormat?.type === "json_schema") {
    payload.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.responseFormat.json_schema.name,
        strict: request.responseFormat.json_schema.strict ?? true,
        schema: request.responseFormat.json_schema.schema
      }
    };
  }

  return payload;
}

function assertConfigured(config: ModelConfig): void {
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error("Missing vibe model configuration. Configure provider, baseUrl, apiKey, and model.");
  }
}

interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
}

async function fetchWithRetry(
  execute: () => Promise<Response>,
  options: RetryOptions
): Promise<Response> {
  let attempt = 0;

  while (true) {
    const response = await execute();
    if (!shouldRetry(response.status) || attempt >= options.maxRetries) {
      return response;
    }

    const delayMs = readRetryAfter(response) ?? options.initialDelayMs * 2 ** attempt;
    await sleep(delayMs);
    attempt += 1;
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 503;
}

function readRetryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) {
    return undefined;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds)) {
    return Math.max(0, Math.round(asSeconds * 1000));
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - Date.now());
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function toNetworkError(baseUrl: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `Model network request failed for ${baseUrl}. Check baseUrl, API key, VPN/proxy, and provider status. Original error: ${reason}`
  );
}
