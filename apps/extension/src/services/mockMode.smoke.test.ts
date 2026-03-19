import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWorkspacePersistence, ensureWorkspaceStorage } from "@code-vibe/persistence";
import type { ModelConfig } from "@code-vibe/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class EventEmitter<T> {
    private listeners = new Set<(value: T) => void>();

    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return {
        dispose: () => {
          this.listeners.delete(listener);
        }
      };
    };

    fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }
  }

  return {
    EventEmitter
  };
});

const createdPaths: string[] = [];

describe("mock mode smoke test", () => {
  afterEach(async () => {
    await Promise.all(
      createdPaths.splice(0).map(async (targetPath) => {
        await fs.rm(targetPath, { recursive: true, force: true });
      })
    );
  });

  it("creates a thread and adds a derived card to the canvas with the mock provider", async () => {
    const [{ IndexService }, { ThreadService }, { CardService }, { CanvasService }] = await Promise.all([
      import("./indexService"),
      import("./threadService"),
      import("./cardService"),
      import("./canvasService")
    ]);

    const workspaceRoot = await makeFixtureWorkspace();
    createdPaths.push(workspaceRoot);

    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-extension-smoke-"));
    createdPaths.push(storageRoot);
    await ensureWorkspaceStorage(storageRoot);

    const output = {
      appendLine: vi.fn()
    };

    const persistence = createWorkspacePersistence(storageRoot, "workspace");
    const indexService = new IndexService(workspaceRoot, persistence, output as never);
    const threadService = new ThreadService(persistence, indexService, output as never);
    const cardService = new CardService(persistence, indexService);
    const canvasService = new CanvasService(persistence, indexService, cardService);

    await Promise.all([
      indexService.initialize(),
      threadService.initialize(),
      cardService.initialize(),
      canvasService.initialize()
    ]);

    const mockConfig: ModelConfig = {
      provider: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-grounded",
      temperature: 0.1,
      maxTokens: 1024
    };

    const thread = await threadService.askQuestion(
      "How does session creation work?",
      {
        activeFile: "src/auth.ts",
        startLine: 1,
        endLine: 3,
        selectedText: "export function createSession(userId: string) { return issueToken(userId); }"
      },
      mockConfig
    );

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.role).toBe("assistant");
    expect(thread.messages[1]?.content).toContain("Source references");
    expect(threadService.getThreads()).toHaveLength(1);

    const card = await cardService.createCardFromThread(thread);
    await canvasService.addCard(card.id);

    const canvas = await canvasService.getCanvas();
    expect(card.summary).toContain("Source references");
    expect(canvas.nodes.some((node) => node.cardId === card.id)).toBe(true);
  });

  it("deletes a persisted thread", async () => {
    const [{ IndexService }, { ThreadService }] = await Promise.all([
      import("./indexService"),
      import("./threadService")
    ]);

    const workspaceRoot = await makeFixtureWorkspace();
    createdPaths.push(workspaceRoot);

    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-extension-smoke-"));
    createdPaths.push(storageRoot);
    await ensureWorkspaceStorage(storageRoot);

    const output = {
      appendLine: vi.fn()
    };

    const persistence = createWorkspacePersistence(storageRoot, "workspace");
    const indexService = new IndexService(workspaceRoot, persistence, output as never);
    const threadService = new ThreadService(persistence, indexService, output as never);

    await Promise.all([indexService.initialize(), threadService.initialize()]);

    const mockConfig: ModelConfig = {
      provider: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-grounded",
      temperature: 0.1,
      maxTokens: 1024
    };

    const thread = await threadService.askQuestion(
      "What does this module do?",
      {
        activeFile: "src/auth.ts",
        startLine: 1,
        endLine: 3,
        selectedText: "export function createSession(userId: string) { return issueToken(userId); }"
      },
      mockConfig
    );

    await expect(threadService.deleteThread(thread.id)).resolves.toBe(true);
    expect(threadService.getThreads()).toEqual([]);
    await expect(persistence.loadThreads()).resolves.toEqual([]);
  });
});

async function makeFixtureWorkspace(name = "sample-ts-repo"): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(currentDir, "../../../../packages/testkit/fixtures", name);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `vibe-fixture-${name}-`));
  await copyDir(fixturePath, tempDir);
  return tempDir;
}

async function copyDir(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}
