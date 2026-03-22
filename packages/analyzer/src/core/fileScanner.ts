import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".code-vibe",
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  "out"
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".py",
  ".c",
  ".h",
  ".cc",
  ".hh",
  ".cpp",
  ".hpp",
  ".cxx",
  ".hxx",
  ".sh",
  ".bash",
  ".zsh",
  ".json",
  ".jsonc"
]);

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export async function scanWorkspaceFiles(rootPath: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        if (DEFAULT_IGNORES.has(entry.name)) {
          return;
        }

        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
          return;
        }

        const content = await fs.readFile(fullPath, "utf8");
        results.push({
          absolutePath: fullPath,
          relativePath: toPosix(path.relative(rootPath, fullPath)),
          content
        });
      })
    );
  }

  await walk(rootPath);
  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return results;
}

export function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
