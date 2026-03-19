import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Thread, WorkspaceIndex } from "@code-vibe/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceStorageKey, prepareWorkspaceStorage } from "./workspaceStorage";

const createdPaths: string[] = [];

describe("workspaceStorage", () => {
  afterEach(async () => {
    await Promise.all(
      createdPaths.splice(0).map(async (targetPath) => {
        await fs.rm(targetPath, { recursive: true, force: true });
      })
    );
  });

  it("uses distinct storage roots for different workspace folders", async () => {
    const firstWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-project-a-"));
    const secondWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-project-b-"));
    const legacyStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-storage-legacy-"));
    createdPaths.push(firstWorkspaceRoot, secondWorkspaceRoot, legacyStorageRoot);

    const first = await prepareWorkspaceStorage(legacyStorageRoot, firstWorkspaceRoot);
    const second = await prepareWorkspaceStorage(legacyStorageRoot, secondWorkspaceRoot);

    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(first.storageRoot).not.toBe(second.storageRoot);
    expect(first.storageRoot).toBe(path.join(firstWorkspaceRoot, ".code-vibe", "storage"));
  });

  it("migrates only the current workspace data from legacy shared storage", async () => {
    const currentWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-project-a-"));
    const legacyStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-storage-legacy-"));
    createdPaths.push(currentWorkspaceRoot, legacyStorageRoot);

    const currentWorkspaceId = createWorkspaceStorageKey(currentWorkspaceRoot);
    const otherWorkspaceId = createWorkspaceStorageKey("/tmp/project-b");

    const threads: Thread[] = [
      {
        id: "thread-a",
        workspaceId: currentWorkspaceId,
        title: "Current workspace thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        contextRefs: [],
        messages: []
      },
      {
        id: "thread-b",
        workspaceId: otherWorkspaceId,
        title: "Other workspace thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        contextRefs: [],
        messages: []
      }
    ];
    const index: WorkspaceIndex = {
      snapshot: {
        id: currentWorkspaceId,
        rootUri: currentWorkspaceRoot,
        revision: "1",
        languageSet: ["typescript"],
        indexedAt: "2026-01-01T00:00:00.000Z",
        analyzerVersion: "0.1.0"
      },
      nodes: [],
      edges: [],
      fileContents: {}
    };

    await fs.writeFile(path.join(legacyStorageRoot, "threads.json"), `${JSON.stringify(threads, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(legacyStorageRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

    const prepared = await prepareWorkspaceStorage(legacyStorageRoot, currentWorkspaceRoot);
    const migratedThreads = JSON.parse(
      await fs.readFile(path.join(prepared.storageRoot, "threads.json"), "utf8")
    ) as Thread[];
    const migratedIndex = JSON.parse(
      await fs.readFile(path.join(prepared.storageRoot, "index.json"), "utf8")
    ) as WorkspaceIndex;

    expect(prepared.migrated).toBe(true);
    expect(migratedThreads).toEqual([threads[0]]);
    expect(migratedIndex.snapshot.id).toBe(currentWorkspaceId);
    await expect(readJson(path.join(legacyStorageRoot, "threads.json"))).resolves.toEqual([threads[1]]);
    await expect(readJson(path.join(legacyStorageRoot, "index.json"))).resolves.toBeUndefined();
  });
});

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}
