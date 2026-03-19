import { describe, expect, it } from "vitest";

import type { GeneratedProjectOverview } from "../services/projectOverviewService";
import {
  buildProjectOverviewPrompt,
  sanitizeGeneratedProjectOverview
} from "./projectOverviewOrchestrator";

function makeOverview(overrides: Partial<GeneratedProjectOverview> = {}): GeneratedProjectOverview {
  return {
    schemaVersion: 1,
    workspaceId: "workspace_1",
    sourceRevision: "deadbeef",
    generatedAt: "2026-03-19T00:00:00.000Z",
    language: "zh-CN",
    projectGoal: "项目目标",
    implementationNarrative: "实现概述",
    startupEntry: {
      file: "",
      summary: "入口摘要",
      logic: "入口逻辑"
    },
    startupFlow: [],
    keyModules: [],
    executionFlow: [],
    flowDiagram: "",
    uncertainty: "",
    sourceFiles: [],
    ...overrides
  };
}

describe("projectOverviewOrchestrator", () => {
  it("adds an evidence coverage note when source samples exist", () => {
    const overview = sanitizeGeneratedProjectOverview(
      makeOverview({
        uncertainty: "没有找到源码，只能猜测。",
        sourceFiles: ["src/index.ts", "src/app.ts"]
      })
    );

    expect(overview.uncertainty).toContain("2 个送入模型的源码/配置样本");
    expect(overview.uncertainty).not.toContain("没有找到源码");
  });

  it("collapses execution flow when it repeats startup flow", () => {
    const overview = sanitizeGeneratedProjectOverview(
      makeOverview({
        startupFlow: [
          {
            title: "加载配置",
            file: "src/index.ts",
            summary: "读取配置",
            details: "初始化运行参数"
          },
          {
            title: "启动服务",
            file: "src/server.ts",
            summary: "启动 http server",
            details: "开始接收请求"
          }
        ],
        executionFlow: [
          {
            id: "boot-config",
            title: "加载配置",
            file: "src/index.ts",
            summary: "读取配置",
            next: ["boot-server"]
          },
          {
            id: "boot-server",
            title: "启动服务",
            file: "src/server.ts",
            summary: "开始接收请求",
            next: []
          }
        ],
        flowDiagram: "flowchart TD\nboot-config --> boot-server"
      })
    );

    expect(overview.executionFlow).toEqual([]);
    expect(overview.flowDiagram).toBe("");
  });

  it("fills the startup entry file from the first startup step", () => {
    const overview = sanitizeGeneratedProjectOverview(
      makeOverview({
        startupFlow: [
          {
            title: "入口",
            file: "src/main.ts",
            summary: "应用启动",
            details: "注册依赖并启动"
          }
        ]
      })
    );

    expect(overview.startupEntry.file).toBe("src/main.ts");
  });

  it("instructs the model not to claim missing source when excerpts exist", () => {
    const prompt = buildProjectOverviewPrompt(
      "zh-CN",
      {
        primaryLanguage: "TypeScript",
        coreDirectories: ["src"],
        entryCandidates: ["src/index.ts"],
        coreModules: ["src/runtime.ts"],
        topFunctions: ["run @ src/runtime.ts (3)"],
        readme: "sample readme",
        packageManifest: "{ \"name\": \"demo\" }",
        fileDossiers: [
          {
            path: "src/index.ts",
            reason: "entry",
            symbolOutline: "- function boot (1-10)",
            excerpt: "export function boot() {}"
          }
        ]
      },
      {
        snapshot: {
          id: "workspace_1",
          rootUri: "/repo",
          revision: "deadbeef",
          languageSet: ["typescript"],
          indexedAt: "2026-03-19T00:00:00.000Z",
          analyzerVersion: "0.1.0"
        },
        nodes: [],
        edges: [],
        fileContents: {}
      }
    );

    expect(prompt.userPrompt).toContain("If code excerpts are present in the dossier, do not say that source code was missing.");
    expect(prompt.userPrompt).toContain("Provided code excerpts: 1");
  });
});
