import fs from "node:fs/promises";
import path from "node:path";

import type { CanvasState, Card, Thread, WorkspaceIndex } from "@code-vibe/shared";

const STORAGE_FILES = {
  threads: "threads.json",
  cards: "cards.json",
  canvas: "canvas.json",
  index: "index.json"
} as const;
const LOCAL_STORAGE_ROOT_PARTS = [".code-vibe", "storage"] as const;

export interface WorkspaceStoragePaths {
  workspaceId: string;
  storageRoot: string;
  legacyStorageRoot: string;
}

export interface PreparedWorkspaceStorage extends WorkspaceStoragePaths {
  migrated: boolean;
}

export async function prepareWorkspaceStorage(
  legacyStorageRoot: string,
  workspaceRoot: string
): Promise<PreparedWorkspaceStorage> {
  const workspaceId = createWorkspaceStorageKey(workspaceRoot);
  const storageRoot = path.join(path.resolve(workspaceRoot), ...LOCAL_STORAGE_ROOT_PARTS);
  const paths = { workspaceId, storageRoot, legacyStorageRoot };
  const migrated = await migrateLegacyWorkspaceStorage(paths, workspaceRoot);
  await fs.mkdir(storageRoot, { recursive: true });
  return { ...paths, migrated };
}

export function createWorkspaceStorageKey(workspaceRoot: string): string {
  return `workspace_${hashText(path.resolve(workspaceRoot))}`;
}

async function migrateLegacyWorkspaceStorage(
  paths: WorkspaceStoragePaths,
  workspaceRoot: string
): Promise<boolean> {
  if (path.resolve(paths.legacyStorageRoot) === path.resolve(paths.storageRoot)) {
    return false;
  }

  if (await hasWorkspaceData(paths.storageRoot)) {
    return false;
  }

  const [threads, cards, canvas, index] = await Promise.all([
    readJsonFile<Thread[]>(path.join(paths.legacyStorageRoot, STORAGE_FILES.threads)),
    readJsonFile<Card[]>(path.join(paths.legacyStorageRoot, STORAGE_FILES.cards)),
    readJsonFile<CanvasState | null>(path.join(paths.legacyStorageRoot, STORAGE_FILES.canvas)),
    readJsonFile<WorkspaceIndex | null>(path.join(paths.legacyStorageRoot, STORAGE_FILES.index))
  ]);

  const nextThreads = (threads ?? []).filter((thread) => thread.workspaceId === paths.workspaceId);
  const nextCards = (cards ?? []).filter((card) => card.workspaceId === paths.workspaceId);
  const nextCanvas = (() => {
    if (!canvas || canvas.workspaceId !== paths.workspaceId) {
      return null;
    }

    const nextNodes = canvas.nodes.filter((node) => nextCards.some((card) => card.id === node.cardId));
    return {
      ...canvas,
      nodes: nextNodes,
      edges: canvas.edges.filter(
        (edge) =>
          nextNodes.some((node) => node.id === edge.fromNodeId) &&
          nextNodes.some((node) => node.id === edge.toNodeId)
      )
    };
  })();
  const nextIndex =
    index &&
    (index.snapshot.id === paths.workspaceId || path.resolve(index.snapshot.rootUri) === path.resolve(workspaceRoot))
      ? index
      : null;

  if (nextThreads.length === 0 && nextCards.length === 0 && !nextCanvas && !nextIndex) {
    return false;
  }

  await fs.mkdir(paths.storageRoot, { recursive: true });
  await Promise.all([
    nextThreads.length > 0
      ? writeJsonFile(path.join(paths.storageRoot, STORAGE_FILES.threads), nextThreads)
      : Promise.resolve(),
    nextCards.length > 0
      ? writeJsonFile(path.join(paths.storageRoot, STORAGE_FILES.cards), nextCards)
      : Promise.resolve(),
    nextCanvas ? writeJsonFile(path.join(paths.storageRoot, STORAGE_FILES.canvas), nextCanvas) : Promise.resolve(),
    nextIndex ? writeJsonFile(path.join(paths.storageRoot, STORAGE_FILES.index), nextIndex) : Promise.resolve()
  ]);
  await cleanupLegacyWorkspaceStorage(paths, {
    workspaceRoot,
    threads,
    cards,
    canvas,
    index
  });
  return true;
}

async function hasWorkspaceData(storageRoot: string): Promise<boolean> {
  const entries = await Promise.all(
    Object.values(STORAGE_FILES).map(async (fileName) => {
      try {
        await fs.access(path.join(storageRoot, fileName));
        return true;
      } catch {
        return false;
      }
    })
  );

  return entries.some(Boolean);
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function cleanupLegacyWorkspaceStorage(
  paths: WorkspaceStoragePaths,
  data: {
    workspaceRoot: string;
    threads?: Thread[];
    cards?: Card[];
    canvas?: CanvasState | null;
    index?: WorkspaceIndex | null;
  }
): Promise<void> {
  const remainingThreads = (data.threads ?? []).filter((thread) => thread.workspaceId !== paths.workspaceId);
  const remainingCards = (data.cards ?? []).filter((card) => card.workspaceId !== paths.workspaceId);

  await Promise.all([
    cleanupLegacyArrayFile(path.join(paths.legacyStorageRoot, STORAGE_FILES.threads), remainingThreads),
    cleanupLegacyArrayFile(path.join(paths.legacyStorageRoot, STORAGE_FILES.cards), remainingCards),
    data.canvas?.workspaceId === paths.workspaceId
      ? removeFileIfExists(path.join(paths.legacyStorageRoot, STORAGE_FILES.canvas))
      : Promise.resolve(),
    data.index &&
    (data.index.snapshot.id === paths.workspaceId ||
      path.resolve(data.index.snapshot.rootUri) === path.resolve(data.workspaceRoot))
      ? removeFileIfExists(path.join(paths.legacyStorageRoot, STORAGE_FILES.index))
      : Promise.resolve()
  ]);
}

async function cleanupLegacyArrayFile(filePath: string, value: unknown[]): Promise<void> {
  if (value.length === 0) {
    await removeFileIfExists(filePath);
    return;
  }

  await writeJsonFile(filePath, value);
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    return;
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
