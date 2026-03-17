import * as vscode from "vscode";
import { COMMANDS } from "@code-vibe/shared";

import type { IndexService, ProjectSummary } from "../services/indexService";

export function registerOpenProjectOverviewCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openProjectOverview, async () => {
      const summary = indexService.getProjectSummary();
      if (!summary) {
        vscode.window.showInformationMessage("Project overview is not available yet. Try refreshing the index.");
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "vibe.projectOverview",
        "Project Overview",
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      panel.webview.html = renderOverviewHtml(summary);
    })
  );
}

function renderOverviewHtml(summary: ProjectSummary): string {
  const entryFile = summary.entryFiles[0] ?? "none";

  const toList = (items: string[]): string =>
    items.length > 0
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "<p>None</p>";

  const topFunctions =
    summary.topFunctions.length > 0
      ? `<ul class="top-functions">${summary.topFunctions
          .map((item) => `<li>${escapeHtml(item.name)} (${escapeHtml(item.path)}) - ${item.calls}</li>`)
          .join("")}</ul>`
      : "<p>None</p>";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Overview</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.65;
      font-size: 15px;
    }

    .container {
      max-width: 880px;
      margin: 0 auto;
      padding: 22px 20px 24px;
    }

    .hero {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 14px;
      padding: 18px 20px;
      background: color-mix(in srgb, var(--vscode-editor-background) 78%, var(--vscode-textBlockQuote-background) 22%);
      box-shadow: 0 6px 20px color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
    }

    h1 {
      font-size: 28px;
      margin: 0 0 8px;
      line-height: 1.2;
      font-weight: 700;
    }

    h2 {
      font-size: 19px;
      margin-top: 22px;
      margin-bottom: 10px;
      line-height: 1.35;
      font-weight: 650;
    }

    p {
      margin: 8px 0;
      font-size: 15px;
    }

    ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }

    li {
      margin: 4px 0;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      margin-top: 16px;
    }

    .panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 14px 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
      min-width: 0;
      overflow: hidden;
    }

    .panel ul li {
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
    }

    .top-functions {
      font-family: Consolas, "Cascadia Code", "Courier New", monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <h1>Project Overview</h1>
      <p><strong>Primary language:</strong> ${escapeHtml(summary.primaryLanguage)}</p>
      <p><strong>Entry file:</strong> ${escapeHtml(entryFile)}</p>
      <p class="muted">已按入口优先级与调用度回退策略自动识别。</p>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Core directories</h2>
        ${toList(summary.coreDirectories)}
      </div>
      <div class="panel">
        <h2>Entry candidates</h2>
        ${toList(summary.entryFiles)}
      </div>
      <div class="panel">
        <h2>Core modules</h2>
        ${toList(summary.coreModules)}
      </div>
      <div class="panel">
        <h2>Top functions</h2>
        ${topFunctions}
      </div>
    </section>

  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
