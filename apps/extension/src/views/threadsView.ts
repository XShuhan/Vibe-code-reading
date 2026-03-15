import * as vscode from "vscode";

import type { Thread } from "@code-vibe/shared";

import type { ThreadService } from "../services/threadService";

export class ThreadsViewProvider implements vscode.TreeDataProvider<Thread> {
  private readonly emitter = new vscode.EventEmitter<Thread | undefined>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly threadService: ThreadService) {
    this.threadService.onDidChange(() => this.emitter.fire(undefined));
  }

  getTreeItem(thread: Thread): vscode.TreeItem {
    const item = new vscode.TreeItem(thread.title, vscode.TreeItemCollapsibleState.None);
    const typeLabel = formatQuestionType(thread.questionType);
    item.description = `${typeLabel} · ${new Date(thread.updatedAt).toLocaleString()}`;
    item.tooltip = thread.contextRefs.join("\n");
    item.contextValue = thread.questionType ? `thread.${thread.questionType}` : "thread";
    item.command = {
      command: "vibe.openThread",
      title: "Open Thread",
      arguments: [thread]
    };
    item.iconPath = new vscode.ThemeIcon(resolveIcon(thread.questionType));
    return item;
  }

  getChildren(): Thread[] {
    return this.threadService.getThreads();
  }
}

function formatQuestionType(questionType: Thread["questionType"]): string {
  switch (questionType) {
    case "call_flow":
      return "Call Flow";
    case "principle":
      return "Principle";
    case "risk_review":
      return "Risk Review";
    case "module_summary":
      return "Module Summary";
    case "explain_code":
      return "Explain Code";
    default:
      return "Thread";
  }
}

function resolveIcon(questionType: Thread["questionType"]): string {
  switch (questionType) {
    case "call_flow":
      return "type-hierarchy-sub";
    case "principle":
      return "lightbulb";
    case "risk_review":
      return "warning";
    case "module_summary":
      return "file-submodule";
    case "explain_code":
      return "code";
    default:
      return "comment-discussion";
  }
}

