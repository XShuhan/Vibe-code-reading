import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";

import {
  getWorkspaceLanguage,
  onDidChangeWorkspacePreferences,
  type WorkspaceLanguage
} from "../config/settings";
import type { IndexService } from "../services/indexService";
import type {
  GeneratedProjectOverview,
  ProjectOverviewFlowNode,
  ProjectOverviewService,
  ProjectOverviewStatus
} from "../services/projectOverviewService";

export function registerOpenProjectOverviewCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  projectOverviewService: ProjectOverviewService
): void {
  let panel: vscode.WebviewPanel | undefined;

  const render = async (): Promise<void> => {
    if (!panel) {
      return;
    }

    const language = await getWorkspaceLanguage(context);
    panel.title = language === "zh-CN" ? "项目概览" : "Project Overview";
    panel.webview.html = renderOverviewHtml(
      projectOverviewService.getOverview(),
      projectOverviewService.getStatus(),
      projectOverviewService.getLastError(),
      language,
      indexService.getRootPath()
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openProjectOverview, async () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        await render();
        return;
      }

      panel = vscode.window.createWebviewPanel(
        "vibe.projectOverview",
        "Project Overview",
        vscode.ViewColumn.Beside,
        { enableScripts: true, enableCommandUris: true, retainContextWhenHidden: true }
      );
      panel.onDidDispose(() => {
        panel = undefined;
      });

      await render();
    }),
    projectOverviewService.onDidChange(() => {
      void render();
    }),
    indexService.onDidChange(() => {
      void render();
    }),
    onDidChangeWorkspacePreferences(() => {
      void render();
    })
  );
}

function renderOverviewHtml(
  overview: GeneratedProjectOverview | null,
  status: ProjectOverviewStatus,
  errorMessage: string,
  language: WorkspaceLanguage,
  rootPath: string
): string {
  const copy = getCopy(language);
  const refreshUri = `command:${COMMANDS.refreshIndex}`;
  const statusBadge = renderStatusBadge(status, language);

  if (!overview) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${copy.title}</title>
  <style>${getBaseCss()}</style>
</head>
<body>
  <div class="page">
    <section class="hero empty">
      <div class="eyebrow">${copy.title}</div>
      <h1>${copy.emptyTitle}</h1>
      <p>${status === "generating" ? copy.generatingMessage : copy.emptyMessage}</p>
      ${errorMessage ? `<p class="warning">${escapeHtml(errorMessage)}</p>` : ""}
      <a class="button" href="${refreshUri}">${copy.refreshAction}</a>
      <p class="meta">${escapeHtml(rootPath)}</p>
    </section>
  </div>
</body>
</html>`;
  }

  const flowLookup = new Map(overview.executionFlow.map((node) => [node.id, node]));
  const flowCards = overview.executionFlow
    .map((node, index) => renderFlowCard(node, flowLookup, index, language))
    .join("");

  const startupFlow = overview.startupFlow.length
    ? overview.startupFlow
        .map(
          (step, index) => `
          <article class="step-card">
            <div class="step-index">${index + 1}</div>
            <div class="step-body">
              <h3>${escapeHtml(step.title || step.file || `${copy.stepLabel} ${index + 1}`)}</h3>
              <p class="file-chip">${escapeHtml(step.file || copy.notAvailable)}</p>
              <p>${escapeHtml(step.summary || copy.notAvailable)}</p>
              <p class="muted">${escapeHtml(step.details || copy.notAvailable)}</p>
            </div>
          </article>`
        )
        .join("")
    : `<p class="muted">${copy.notAvailable}</p>`;

  const keyModules = overview.keyModules.length
    ? overview.keyModules
        .map(
          (module) => `
          <article class="module-card">
            <h3>${escapeHtml(module.name || copy.notAvailable)}</h3>
            <p class="file-chip">${escapeHtml(module.file || copy.notAvailable)}</p>
            <p>${escapeHtml(module.responsibility || copy.notAvailable)}</p>
          </article>`
        )
        .join("")
    : `<p class="muted">${copy.notAvailable}</p>`;
  const sourceFiles = overview.sourceFiles.length
    ? overview.sourceFiles
        .map((file) => `<li class="chip-item">${escapeHtml(file)}</li>`)
        .join("")
    : `<li class="muted">${copy.noSourceFilesMessage}</li>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${copy.title}</title>
  <style>${getBaseCss()}</style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="hero-top">
        <div class="eyebrow">${copy.title}</div>
        ${statusBadge}
      </div>
      <h1>${escapeHtml(overview.projectGoal || copy.notAvailable)}</h1>
      <p class="hero-text">${escapeHtml(overview.implementationNarrative || copy.notAvailable)}</p>
      <div class="hero-actions">
        <a class="button" href="${refreshUri}">${copy.refreshAction}</a>
        <span class="meta">${escapeHtml(rootPath)}</span>
      </div>
      ${status === "stale" ? `<p class="warning">${copy.staleMessage}</p>` : ""}
      ${status === "error" && errorMessage ? `<p class="warning">${escapeHtml(errorMessage)}</p>` : ""}
    </section>

    <section class="grid two-up">
      <article class="panel">
        <div class="panel-label">${copy.startupEntryTitle}</div>
        <h2>${escapeHtml(overview.startupEntry.file || copy.notAvailable)}</h2>
        <p>${escapeHtml(overview.startupEntry.summary || copy.notAvailable)}</p>
        <p class="muted">${escapeHtml(overview.startupEntry.logic || copy.notAvailable)}</p>
      </article>
      <article class="panel">
        <div class="panel-label">${copy.generatedMetaTitle}</div>
        <div class="meta-stack">
          <p><strong>${copy.generatedAtLabel}</strong> ${escapeHtml(overview.generatedAt)}</p>
          <p><strong>${copy.sourceRevisionLabel}</strong> ${escapeHtml(overview.sourceRevision)}</p>
          <p><strong>${copy.sourceFileCountLabel}</strong> ${overview.sourceFiles.length}</p>
        </div>
        <p class="panel-note">${copy.sourceRevisionNote}</p>
        <div class="meta-subtitle">${copy.sourceFilesLabel}</div>
        <ul class="chip-list">${sourceFiles}</ul>
        <p class="panel-note">${
          overview.sourceFiles.length > 0 ? copy.sourceFilesNote : copy.noSourceFilesNote
        }</p>
      </article>
    </section>

    <section class="panel">
      <div class="panel-label">${copy.startupFlowTitle}</div>
      <div class="step-list">
        ${startupFlow}
      </div>
    </section>

    <section class="panel">
      <div class="panel-label">${copy.keyModulesTitle}</div>
      <div class="module-grid">
        ${keyModules}
      </div>
    </section>

    <section class="panel">
      <div class="panel-label">${copy.executionFlowTitle}</div>
      <div class="flow-stack">
        ${
          flowCards ||
          `<p class="muted">${
            overview.startupFlow.length > 0
              ? copy.executionFlowCondensedMessage
              : copy.notAvailable
          }</p>`
        }
      </div>
      ${
        overview.flowDiagram
          ? `<details class="code-panel"><summary>${copy.flowDiagramTitle}</summary><pre>${escapeHtml(overview.flowDiagram)}</pre></details>`
          : ""
      }
    </section>

    <section class="panel">
      <div class="panel-label">${copy.uncertaintyTitle}</div>
      <p class="panel-note">${copy.uncertaintyNote}</p>
      <p>${escapeHtml(overview.uncertainty || copy.notAvailable)}</p>
    </section>
  </div>
</body>
</html>`;
}

function renderFlowCard(
  node: ProjectOverviewFlowNode,
  lookup: Map<string, ProjectOverviewFlowNode>,
  index: number,
  language: WorkspaceLanguage
): string {
  const nextLabels = node.next
    .map((id) => lookup.get(id)?.title || id)
    .filter(Boolean)
    .join(language === "zh-CN" ? "、" : ", ");

  return `
    <article class="flow-card">
      <div class="flow-index">${index + 1}</div>
      <div class="flow-body">
        <h3>${escapeHtml(node.title)}</h3>
        <p class="file-chip">${escapeHtml(node.file || "")}</p>
        <p>${escapeHtml(node.summary || "")}</p>
        ${
          nextLabels
            ? `<p class="muted">${language === "zh-CN" ? "流向：" : "Next:"} ${escapeHtml(nextLabels)}</p>`
            : ""
        }
      </div>
    </article>
    ${index < lookup.size - 1 ? '<div class="flow-arrow">↓</div>' : ""}`;
}

function renderStatusBadge(status: ProjectOverviewStatus, language: WorkspaceLanguage): string {
  const label = (() => {
    switch (status) {
      case "generating":
        return language === "zh-CN" ? "分析中" : "Analyzing";
      case "stale":
        return language === "zh-CN" ? "待刷新" : "Stale";
      case "error":
        return language === "zh-CN" ? "异常" : "Error";
      case "ready":
        return language === "zh-CN" ? "已生成" : "Ready";
      default:
        return language === "zh-CN" ? "未生成" : "Not ready";
    }
  })();

  return `<span class="badge badge-${status}">${label}</span>`;
}

function getCopy(language: WorkspaceLanguage): Record<string, string> {
  if (language === "zh-CN") {
    return {
      title: "项目概览",
      emptyTitle: "还没有 AI 项目概览",
      emptyMessage: "点击刷新索引后，系统会基于代码索引和关键文件生成项目概览、启动链路和代码流图。",
      generatingMessage: "正在根据最新索引生成 AI 项目概览。这个过程会分析入口文件、关键模块和执行路径。",
      refreshAction: "刷新索引并生成概览",
      staleMessage: "当前概览与最新索引或当前语言不一致，建议重新刷新生成。",
      startupEntryTitle: "启动入口",
      generatedMetaTitle: "本次生成依据",
      generatedAtLabel: "生成时间：",
      sourceRevisionLabel: "索引快照：",
      sourceRevisionNote: "索引快照用于判断概览是否仍匹配最近一次扫描结果，不等同于 Git commit。",
      sourceFileCountLabel: "源码样本数：",
      sourceFilesLabel: "送入模型的关键源码/配置样本",
      sourceFilesNote: "这里只展示本次概览生成时注入给模型的关键文件样本，不代表仓库只有这些文件。",
      noSourceFilesNote: "本次没有拿到可直接注入模型的源码摘录，概览会更多依赖索引摘要和配置文件。",
      noSourceFilesMessage: "本次未注入源码摘录",
      startupFlowTitle: "启动链路（初始化）",
      keyModulesTitle: "核心模块分工",
      executionFlowTitle: "主执行路径",
      executionFlowCondensedMessage: "主执行路径与启动链路高度重合，或证据不足以可靠区分，因此这里省略单独流程图。",
      flowDiagramTitle: "Mermaid 流程图源码",
      uncertaintyTitle: "证据边界",
      uncertaintyNote: "这里描述的是证据覆盖范围和仍未被源码完全证实的部分，不代表系统完全没有读到源码。",
      notAvailable: "暂无",
      stepLabel: "步骤"
    };
  }

  return {
    title: "Project Overview",
    emptyTitle: "No AI project overview yet",
    emptyMessage:
      "After you refresh the index, the extension will analyze the codebase and generate a project overview, startup path, and execution flow.",
    generatingMessage:
      "Generating an AI project overview from the latest index. This analyzes entry files, key modules, and the execution path.",
    refreshAction: "Refresh Index and Generate Overview",
    staleMessage: "This overview no longer matches the latest index or current language. Refresh to regenerate it.",
    startupEntryTitle: "Startup Entry",
    generatedMetaTitle: "Generation Basis",
    generatedAtLabel: "Generated at:",
    sourceRevisionLabel: "Index snapshot:",
    sourceRevisionNote:
      "The snapshot id is used to detect whether the overview still matches the latest scan. It is not a Git commit hash.",
    sourceFileCountLabel: "Source samples:",
    sourceFilesLabel: "Key source/config samples sent to the model",
    sourceFilesNote:
      "This list only shows the key files injected into the overview prompt. It does not mean the repository only contains these files.",
    noSourceFilesNote:
      "No source excerpts were injected for this run, so the overview leans more on index summaries and config files.",
    noSourceFilesMessage: "No injected source excerpts for this run",
    startupFlowTitle: "Startup Path",
    keyModulesTitle: "Core Module Responsibilities",
    executionFlowTitle: "Primary Runtime Flow",
    executionFlowCondensedMessage:
      "The runtime flow substantially overlaps with startup, or the evidence is too thin to separate it reliably, so the extra flow view was omitted.",
    flowDiagramTitle: "Mermaid Flowchart Source",
    uncertaintyTitle: "Evidence Limits",
    uncertaintyNote:
      "This section describes coverage limits and unproven edges in the evidence set. It does not automatically mean source code was absent.",
    notAvailable: "Not available",
    stepLabel: "Step"
  };
}

function getBaseCss(): string {
  return `
    :root {
      color-scheme: light dark;
      --page-max: 1080px;
      --border: color-mix(in srgb, var(--vscode-editor-foreground) 14%, transparent);
      --panel: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background) 16%);
      --hero: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editor-background) 78%, var(--vscode-textBlockQuote-background) 22%),
        color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-button-background) 8%)
      );
      --accent: var(--vscode-button-background);
      --accent-text: var(--vscode-button-foreground);
      --muted: var(--vscode-descriptionForeground);
      --shadow: 0 12px 32px color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font: 15px/1.65 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 16%, transparent), transparent 28%),
        var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    .page {
      max-width: var(--page-max);
      margin: 0 auto;
      padding: 22px 20px 40px;
      display: grid;
      gap: 18px;
    }

    .hero, .panel {
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 24px;
      background: var(--hero);
    }

    .hero.empty {
      min-height: 320px;
      display: grid;
      align-content: center;
      justify-items: start;
      gap: 10px;
    }

    .hero-top, .hero-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .eyebrow, .panel-label {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }

    h1 {
      margin: 8px 0 10px;
      font-size: clamp(28px, 5vw, 38px);
      line-height: 1.15;
    }

    h2 {
      margin: 6px 0 10px;
      font-size: 22px;
      line-height: 1.25;
    }

    h3 {
      margin: 0 0 6px;
      font-size: 18px;
      line-height: 1.3;
    }

    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .hero-text {
      font-size: 16px;
      max-width: 72ch;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 12px;
      font-weight: 700;
      background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent);
    }

    .badge-generating { color: #d97706; }
    .badge-stale { color: #ea580c; }
    .badge-error { color: #dc2626; }
    .badge-ready { color: #16a34a; }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 0 14px;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-text);
      text-decoration: none;
      font-weight: 700;
    }

    .meta, .muted {
      color: var(--muted);
      font-size: 13px;
    }

    .warning {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, #f59e0b 40%, var(--border));
      background: color-mix(in srgb, #f59e0b 14%, transparent);
    }

    .meta-stack {
      display: grid;
      gap: 4px;
    }

    .meta-subtitle {
      margin-top: 12px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }

    .panel-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .grid {
      display: grid;
      gap: 18px;
    }

    .two-up {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .panel {
      padding: 20px;
      display: grid;
      gap: 14px;
    }

    .step-list, .flow-stack, .module-grid {
      display: grid;
      gap: 14px;
    }

    .step-card, .flow-card, .module-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
    }

    .step-card, .flow-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
      align-items: start;
    }

    .step-index, .flow-index {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 700;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: var(--vscode-editor-foreground);
    }

    .module-grid {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .module-card {
      padding: 14px;
      display: grid;
      gap: 10px;
    }

    .file-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 999px;
      width: fit-content;
      max-width: 100%;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--muted);
      font: 12px/1.4 Consolas, "Cascadia Code", "Courier New", monospace;
    }

    .chip-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip-item {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
      color: var(--muted);
      font: 12px/1.4 Consolas, "Cascadia Code", "Courier New", monospace;
      word-break: break-all;
    }

    .flow-arrow {
      justify-self: center;
      color: var(--muted);
      font-size: 22px;
      line-height: 1;
    }

    .code-panel {
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }

    pre {
      margin: 10px 0 0;
      padding: 14px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, black 20%);
      color: var(--vscode-editor-foreground);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.55 Consolas, "Cascadia Code", monospace;
    }

    @media (max-width: 820px) {
      .page {
        padding: 16px 14px 28px;
      }

      .two-up {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
