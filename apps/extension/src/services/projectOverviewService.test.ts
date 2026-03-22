import { describe, expect, it } from "vitest";

import {
  applyDeterministicOverviewFallback,
  buildOverviewRepairPrompt,
  safeParseJsonObject,
  shouldRunOverviewRewritePass
} from "./projectOverviewService";

describe("projectOverviewService.safeParseJsonObject", () => {
  it("parses JSON wrapped in markdown fences", () => {
    const parsed = safeParseJsonObject([
      "```json",
      "{",
      '  "projectGoal": "demo",',
      '  "implementationNarrative": "demo narrative",',
      '  "startupEntry": { "file": "src/index.ts", "summary": "boot", "logic": "boot logic" },',
      '  "startupFlow": [],',
      '  "keyModules": [],',
      '  "executionFlow": [],',
      '  "flowDiagram": "",',
      '  "uncertainty": "sample only"',
      "}",
      "```"
    ].join("\n"));

    expect(parsed?.projectGoal).toBe("demo");
    expect(parsed?.startupEntry).toEqual({
      file: "src/index.ts",
      summary: "boot",
      logic: "boot logic"
    });
  });

  it("extracts the JSON object when extra text surrounds it", () => {
    const parsed = safeParseJsonObject([
      "Here is the requested JSON:",
      "",
      "{",
      '  "projectGoal": "demo",',
      '  "implementationNarrative": "demo narrative",',
      '  "startupEntry": { "file": "src/main.ts", "summary": "boot", "logic": "boot logic" },',
      '  "startupFlow": [],',
      '  "keyModules": [],',
      '  "executionFlow": [],',
      '  "flowDiagram": "",',
      '  "uncertainty": "sample only"',
      "}",
      "",
      "Let me know if you want changes."
    ].join("\n"));

    expect(parsed?.projectGoal).toBe("demo");
    expect(parsed?.startupEntry).toEqual({
      file: "src/main.ts",
      summary: "boot",
      logic: "boot logic"
    });
  });

  it("unwraps a common overview envelope", () => {
    const parsed = safeParseJsonObject(JSON.stringify({
      overview: {
        projectGoal: "demo",
        implementationNarrative: "demo narrative",
        startupEntry: { file: "src/app.ts", summary: "boot", logic: "boot logic" },
        startupFlow: [],
        keyModules: [],
        executionFlow: [],
        flowDiagram: "",
        uncertainty: "sample only"
      }
    }));

    expect(parsed?.projectGoal).toBe("demo");
    expect(parsed?.startupEntry).toEqual({
      file: "src/app.ts",
      summary: "boot",
      logic: "boot logic"
    });
  });

  it("adds stricter repair instructions for glm-5", () => {
    const prompt = buildOverviewRepairPrompt(
      "{\"project_identity\":{\"name\":\"MiniMind\"}}",
      "en",
      { modelName: "glm-5" }
    );

    expect(prompt).toContain("Do not preserve or emit alternate top-level keys such as project_identity");
    expect(prompt).toContain("Prefer executionFlow as a chronological array of concrete runtime steps");
  });

  it("requests a glm rewrite pass for alternate schemas", () => {
    expect(shouldRunOverviewRewritePass({
      project_identity: "draft",
      entry_points: [],
      core_modules: []
    })).toBe(true);

    expect(shouldRunOverviewRewritePass({
      projectGoal: "demo",
      implementationNarrative: "demo narrative",
      startupEntry: { file: "src/index.ts", summary: "boot", logic: "boot logic" },
      startupFlow: [],
      keyModules: [],
      executionFlow: [],
      flowDiagram: "",
      uncertainty: "sample only"
    })).toBe(false);
  });

  it("rebuilds weak glm overview structure from local dossier data", () => {
    const overview = applyDeterministicOverviewFallback(
      {
        schemaVersion: 1,
        workspaceId: "workspace_1",
        sourceRevision: "deadbeef",
        generatedAt: "2026-03-19T00:00:00.000Z",
        language: "en",
        projectGoal: "MiniMind training project",
        implementationNarrative: "brief",
        startupEntry: {
          file: "Unknown training file",
          summary: "unknown",
          logic: "unknown"
        },
        startupFlow: [],
        keyModules: [],
        executionFlow: [],
        flowDiagram: "",
        uncertainty: "sample only",
        sourceFiles: ["trainer/train_grpo.py", "model/model_minimind.py"]
      },
      {
        modelName: "glm-5",
        language: "en",
        dossier: {
          primaryLanguage: "Python",
          coreDirectories: ["trainer", "model"],
          entryCandidates: ["trainer/train_grpo.py"],
          coreModules: ["trainer/train_grpo.py", "model/model_minimind.py"],
          topFunctions: ["grpo_train_epoch @ trainer/train_grpo.py (6)"],
          readme: "",
          packageManifest: "",
          fileDossiers: [
            {
              path: "trainer/train_grpo.py",
              reason: "Likely startup entry",
              symbolOutline: "- function grpo_train_epoch (10-80)",
              excerpt: "def grpo_train_epoch(): pass"
            },
            {
              path: "model/model_minimind.py",
              reason: "Representative file for core module: model/model_minimind.py",
              symbolOutline: "- class MiniMindConfig (1-40)\n- class Attention (41-120)",
              excerpt: "class MiniMindConfig: pass"
            }
          ]
        },
        index: {
          snapshot: {
            id: "workspace_1",
            rootUri: "/repo",
            revision: "deadbeef",
            languageSet: ["python"],
            indexedAt: "2026-03-19T00:00:00.000Z",
            analyzerVersion: "0.1.0"
          },
          nodes: [
            {
              id: "file1",
              workspaceId: "workspace_1",
              kind: "file",
              name: "train_grpo.py",
              path: "trainer/train_grpo.py",
              rangeStartLine: 1,
              rangeEndLine: 80,
              exported: false
            },
            {
              id: "fn1",
              workspaceId: "workspace_1",
              kind: "function",
              name: "grpo_train_epoch",
              path: "trainer/train_grpo.py",
              rangeStartLine: 10,
              rangeEndLine: 80,
              exported: false
            },
            {
              id: "file2",
              workspaceId: "workspace_1",
              kind: "file",
              name: "model_minimind.py",
              path: "model/model_minimind.py",
              rangeStartLine: 1,
              rangeEndLine: 120,
              exported: false
            }
          ],
          edges: [
            {
              id: "edge1",
              workspaceId: "workspace_1",
              fromNodeId: "fn1",
              toNodeId: "fn1",
              type: "calls"
            }
          ],
          fileContents: {}
        }
      }
    );

    expect(overview.startupEntry.file).toBe("trainer/train_grpo.py");
    expect(overview.startupFlow.length).toBeGreaterThan(0);
    expect(overview.keyModules.some((item) => item.file === "model/model_minimind.py")).toBe(true);
    expect(overview.executionFlow.length).toBeGreaterThan(0);
  });
});
