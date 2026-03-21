import * as vscode from "vscode";

import type {
  WebviewState,
  WebviewToExtensionMessage
} from "@code-vibe/shared";

import type { CardService } from "./cardService";
import type { CanvasService } from "./canvasService";
import type { IndexService } from "./indexService";
import type { ThreadService } from "./threadService";
import { createWebviewHtml } from "../webview/bridge";
import { resolveWebviewDistUri } from "../webview/assets";
import { openCitation } from "../editor/sourceJump";

export class VibeController implements vscode.Disposable {
  private canvasPanel: vscode.WebviewPanel | null = null;
  private readonly threadPanels = new Map<string, vscode.WebviewPanel>();
  private readonly cardPanels = new Map<string, vscode.WebviewPanel>();
  private readonly initializedPanels = new WeakSet<vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewResourceRoots: readonly vscode.Uri[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly indexService: IndexService,
    private readonly threadService: ThreadService,
    private readonly cardService: CardService,
    private readonly canvasService: CanvasService
  ) {
    this.webviewResourceRoots = [
      resolveWebviewDistUri(this.extensionUri)
    ];
    this.disposables.push(
      this.threadService.onDidChange(() => void this.refreshOpenPanels()),
      this.cardService.onDidChange(() => void this.refreshOpenPanels()),
      this.canvasService.onDidChange(() => void this.refreshOpenPanels())
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  async openCanvas(): Promise<void> {
    const state = await this.getCanvasState();
    if (this.canvasPanel) {
      this.canvasPanel.reveal(vscode.ViewColumn.Beside);
      await this.updatePanel(this.canvasPanel, state);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vibe.canvas",
      state.title,
      vscode.ViewColumn.Beside,
      this.getWebviewOptions()
    );
    this.canvasPanel = panel;
    this.attachPanel(panel, state, async (message) => {
      await this.handleCanvasMessage(message);
    });
    panel.onDidDispose(() => {
      this.canvasPanel = null;
    });
  }

  async openThread(threadId: string): Promise<void> {
    const thread = this.threadService.getThread(threadId);
    if (!thread) {
      vscode.window.showWarningMessage("The selected thread could not be found.");
      return;
    }

    const state: WebviewState = {
      kind: "thread",
      title: `Thread: ${thread.title}`,
      thread
    };
    const existing = this.threadPanels.get(threadId);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside);
      await this.updatePanel(existing, state);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vibe.thread",
      state.title,
      vscode.ViewColumn.Beside,
      this.getWebviewOptions()
    );
    this.threadPanels.set(threadId, panel);
    this.attachPanel(panel, state, async (message) => {
      if (message.type === "thread.openCitation") {
        await openCitation(this.indexService.getRootPath(), message.payload);
      }
    });
    panel.onDidDispose(() => {
      this.threadPanels.delete(threadId);
    });
  }

  async openCard(cardId: string): Promise<void> {
    const card = this.cardService.getCard(cardId);
    if (!card) {
      vscode.window.showWarningMessage("The selected card could not be found.");
      return;
    }

    const state: WebviewState = {
      kind: "card",
      title: `Card: ${card.title}`,
      card
    };
    const existing = this.cardPanels.get(cardId);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside);
      await this.updatePanel(existing, state);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vibe.card",
      state.title,
      vscode.ViewColumn.Beside,
      this.getWebviewOptions()
    );
    this.cardPanels.set(cardId, panel);
    this.attachPanel(panel, state, async (message) => {
      if (message.type === "card.openEvidence") {
        await openCitation(this.indexService.getRootPath(), message.payload);
      }
    });
    panel.onDidDispose(() => {
      this.cardPanels.delete(cardId);
    });
  }

  private attachPanel(
    panel: vscode.WebviewPanel,
    state: WebviewState,
    handler: (message: WebviewToExtensionMessage) => Promise<void>
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.webviewResourceRoots
    };
    void this.updatePanel(panel, state);
    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void handler(message);
    });
  }

  private async updatePanel(panel: vscode.WebviewPanel, state: WebviewState): Promise<void> {
    panel.title = state.title;
    if (!this.initializedPanels.has(panel)) {
      panel.webview.html = createWebviewHtml(panel.webview, this.extensionUri, state);
      this.initializedPanels.add(panel);
      return;
    }

    await panel.webview.postMessage({
      type: "bootstrap",
      payload: state
    });
  }

  private getWebviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: this.webviewResourceRoots
    };
  }

  private async refreshOpenPanels(): Promise<void> {
    if (this.canvasPanel) {
      await this.updatePanel(this.canvasPanel, await this.getCanvasState());
    }

    for (const [threadId, panel] of this.threadPanels.entries()) {
      const thread = this.threadService.getThread(threadId);
      if (thread) {
        await this.updatePanel(panel, {
          kind: "thread",
          title: `Thread: ${thread.title}`,
          thread
        });
      } else {
        panel.dispose();
      }
    }

    for (const [cardId, panel] of this.cardPanels.entries()) {
      const card = this.cardService.getCard(cardId);
      if (card) {
        await this.updatePanel(panel, {
          kind: "card",
          title: `Card: ${card.title}`,
          card
        });
      }
    }
  }

  private async getCanvasState(): Promise<WebviewState> {
    const canvas = await this.canvasService.getCanvas();
    const cards = this.cardService.getCards().map((card) => ({
      card,
      node: canvas.nodes.find((node) => node.cardId === card.id)
    }));

    return {
      kind: "canvas",
      title: "Reading Canvas",
      canvas,
      cards
    };
  }

  private async handleCanvasMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "canvas.moveNode":
        await this.canvasService.moveNode(
          message.payload.id,
          message.payload.x,
          message.payload.y,
          message.payload.width,
          message.payload.height
        );
        break;
      case "canvas.addNode":
        await this.canvasService.addCard(message.payload.cardId);
        break;
      case "canvas.createEdge":
        await this.canvasService.createEdge(
          message.payload.fromNodeId,
          message.payload.toNodeId,
          message.payload.relation
        );
        break;
      case "canvas.deleteEdge":
        await this.canvasService.removeEdge(message.payload.edgeId);
        break;
      case "canvas.openCard":
        await this.openCard(message.payload.cardId);
        break;
      default:
        break;
    }
  }
}
