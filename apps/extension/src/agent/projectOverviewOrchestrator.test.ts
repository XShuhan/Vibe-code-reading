import { describe, expect, it } from "vitest";

import type { GeneratedProjectOverview } from "../services/projectOverviewService";
import {
  buildProjectOverviewPrompt,
  normalizeGeneratedProjectOverview,
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

  it("adds stricter schema instructions for glm-5", () => {
    const prompt = buildProjectOverviewPrompt(
      "en",
      {
        primaryLanguage: "TypeScript",
        coreDirectories: ["src"],
        entryCandidates: ["src/index.ts"],
        coreModules: ["src/runtime.ts"],
        topFunctions: ["run @ src/runtime.ts (3)"],
        readme: "sample readme",
        packageManifest: "{ \"name\": \"demo\" }",
        fileDossiers: []
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
      },
      {
        modelName: "glm-5"
      }
    );

    expect(prompt.userPrompt).toContain("Important for this model:");
    expect(prompt.userPrompt).toContain("You must use exactly these top-level keys and no others");
    expect(prompt.userPrompt).toContain("Do not output alternative schemas such as project_identity");
    expect(prompt.userPrompt).toContain("Reference output style example:");
    expect(prompt.systemInstruction).toContain("strict schema compliance");
  });

  it("maps alternate overview field names into the standard schema", () => {
    const overview = normalizeGeneratedProjectOverview(
      {
        project_name: "MiniMind",
        project_type: "Language Model Training Framework with GRPO/RLHF",
        architecture_summary: "MiniMind is a compact transformer-based language model.",
        entry_points: [
          {
            path: "train_grpo.py",
            purpose: "GRPO training entry point",
            status: "inferred from code context"
          }
        ],
        execution_flow: [
          {
            step: 1,
            description: "Initialize config",
            file: "model/model_minimind.py",
            symbol: "MiniMindConfig.__init__",
            code_path: "lines 11-40"
          }
        ],
        key_modules: [
          {
            name: "Model Configuration",
            file: "model/model_minimind.py",
            purpose: "Defines transformer architecture"
          }
        ],
        uncertainties: ["Entry point inferred", "Dataset loader not shown"]
      },
      "en",
      {
        workspaceId: "workspace_1",
        revision: "deadbeef",
        generatedAt: "2026-03-19T00:00:00.000Z",
        sourceFiles: ["train_grpo.py", "model/model_minimind.py"]
      }
    );

    expect(overview.projectGoal).toContain("MiniMind");
    expect(overview.implementationNarrative).toContain("compact transformer-based");
    expect(overview.startupEntry.file).toBe("train_grpo.py");
    expect(overview.startupFlow[0]?.title).toBe("Initialize config");
    expect(overview.keyModules[0]?.name).toBe("Model Configuration");
    expect(overview.executionFlow[0]?.title).toBe("Initialize config");
    expect(overview.uncertainty).toContain("Entry point inferred");
  });

  it("maps glm-style object-shaped overview fields into the standard schema", () => {
    const overview = normalizeGeneratedProjectOverview(
      {
        project_name: "MiniMind-GRPO",
        project_goal:
          "Train a small language model (MiniMind) using Group Relative Policy Optimization (GRPO).",
        entry_points: {
          primary: {
            file: "Unknown - entry point file not provided in dossier",
            uncertainty: "Main training script not visible"
          },
          inferred_from_context: {
            function: "grpo_train_epoch",
            file: "Unknown training file",
            description: "Core training loop"
          }
        },
        execution_flow: [
          {
            step: 1,
            action: "Configuration initialization",
            file: "model/model_minimind.py",
            symbol: "MiniMindConfig.__init__",
            lines: "11-40",
            behavior: "Initializes model hyperparameters"
          }
        ],
        core_modules: {
          model_architecture: {
            file: "model/model_minimind.py",
            classes: ["MiniMindConfig", "Attention"],
            key_features: ["GQA", "YaRN rotary scaling"]
          },
          training: {
            algorithm: "GRPO (Group Relative Policy Optimization)",
            loss_computation: "Uncertain - loss calculation code truncated"
          }
        },
        uncertainties: [
          "Main entry point file not provided",
          "Loss calculation code truncated"
        ],
        inferred_architecture: {
          type: "Decoder-only transformer with optional MOE",
          attention: "Multi-head attention with GQA"
        }
      },
      "en",
      {
        workspaceId: "workspace_1",
        revision: "deadbeef",
        generatedAt: "2026-03-19T00:00:00.000Z",
        sourceFiles: ["model/model_minimind.py"]
      }
    );

    expect(overview.projectGoal).toContain("Group Relative Policy Optimization");
    expect(overview.startupEntry.file).toContain("Unknown");
    expect(overview.startupEntry.logic).toContain("Main training script not visible");
    expect(overview.startupFlow[0]?.title).toBe("Configuration initialization");
    expect(overview.startupFlow[0]?.details).toContain("Initializes model hyperparameters");
    expect(overview.keyModules[0]?.name).toBe("model_architecture");
    expect(overview.executionFlow[0]?.title).toBe("Configuration initialization");
    expect(overview.executionFlow[0]?.summary).toContain("Initializes model hyperparameters");
    expect(overview.uncertainty).toContain("Main entry point file not provided");
  });

  it("maps project_identity and nested training_pipeline into the standard schema", () => {
    const overview = normalizeGeneratedProjectOverview(
      {
        project_identity: {
          name: "MiniMind",
          type: "Small Language Model Training Framework with GRPO",
          primary_goal: "Train a compact transformer language model"
        },
        entry_points: {
          primary: "INFERRED - Likely train_grpo.py",
          uncertainty: "Exact entry point file not shown"
        },
        execution_flow: {
          training_pipeline: [
            {
              step: 1,
              action: "Initialize model and reference model",
              location: "Before grpo_train_epoch call",
              symbols: ["MiniMindConfig", "ref_model"],
              uncertainty: "Model instantiation code not provided"
            },
            {
              step: 2,
              action: "Tokenize prompts with left padding",
              file: "INFERRED from training snippet",
              code_path: "tokenizer(prompts, padding_side='left')"
            }
          ]
        },
        core_modules: {
          model_architecture: {
            file: "model/model_minimind.py",
            config_class: "MiniMindConfig",
            key_components: [
              {
                name: "RMSNorm",
                purpose: "Stable training"
              }
            ]
          }
        },
        uncertainties: ["Data loader not provided"]
      },
      "en",
      {
        workspaceId: "workspace_1",
        revision: "deadbeef",
        generatedAt: "2026-03-19T00:00:00.000Z",
        sourceFiles: ["model/model_minimind.py"]
      }
    );

    expect(overview.projectGoal).toContain("Train a compact transformer");
    expect(overview.startupEntry.file).toContain("train_grpo.py");
    expect(overview.startupEntry.logic).toContain("Exact entry point file not shown");
    expect(overview.startupFlow[0]?.title).toBe("Initialize model and reference model");
    expect(overview.executionFlow[1]?.title).toBe("Tokenize prompts with left padding");
    expect(overview.keyModules[0]?.name).toBe("model_architecture");
    expect(overview.uncertainty).toContain("Data loader not provided");
  });
});
