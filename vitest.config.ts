import path from "node:path";
import { defineConfig } from "vitest/config";

const root = __dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/fixtures/**", "**/code-vibe-testing/**"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@code-vibe/shared": path.resolve(root, "packages/shared/src/index.ts"),
      "@code-vibe/analyzer": path.resolve(root, "packages/analyzer/src/index.ts"),
      "@code-vibe/retrieval": path.resolve(root, "packages/retrieval/src/index.ts"),
      "@code-vibe/model-gateway": path.resolve(root, "packages/model-gateway/src/index.ts"),
      "@code-vibe/persistence": path.resolve(root, "packages/persistence/src/index.ts"),
      "@code-vibe/testkit": path.resolve(root, "packages/testkit/src/index.ts")
    }
  }
});

