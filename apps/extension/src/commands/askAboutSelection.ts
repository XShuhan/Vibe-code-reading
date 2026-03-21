import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { EditorSelectionState, Thread } from "@code-vibe/shared";

import { ensureModelConfigured } from "../config/settings";
import { getActiveSelectionState } from "../editor/selectionContext";
import type { IndexService } from "../services/indexService";
import type { ThreadService } from "../services/threadService";
import type { VibeController } from "../services/vibeController";

type PanelHydrationPayload = {
  suggestion: string;
  contextLabel: string;
  selectionPreview: string;
};

type InlineHydrationPayload = {
  draft: string;
};

type ComposerMessage =
  | {
      type: "ready";
    }
  | {
      type: "submit";
      payload?: {
        question?: string;
      };
    }
  | {
      type: "cancel";
    };

type InlineComposerMessage = ComposerMessage;

type ExtensionToComposerMessage =
  | {
      type: "hydrate";
      payload: PanelHydrationPayload | InlineHydrationPayload;
    }
  | {
      type: "submitResult";
      payload: {
        ok: boolean;
        error?: string;
      };
    };

type SelectionSnapshot = {
  editor: vscode.TextEditor;
  editorState: EditorSelectionState;
  insetLine: number;
};

type WebviewEditorInsetLike = {
  readonly webview: vscode.Webview;
  readonly onDidDispose: vscode.Event<void>;
  dispose(): void;
};

type CreateWebviewTextEditorInset = (
  editor: vscode.TextEditor,
  line: number,
  height: number,
  options?: vscode.WebviewOptions
) => WebviewEditorInsetLike;

const INLINE_INSET_HEIGHT = 4;

export function registerAskAboutSelectionCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  controller: VibeController
): void {
  const composer = createSelectionComposer(context, indexService, threadService, controller);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.askAboutSelection, async () => {
      await composer.open();
    })
  );
}

export async function askAboutSelection(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  controller: VibeController,
  overrideQuestion?: string
): Promise<Thread | undefined> {
  const editorState = getActiveSelectionState(indexService.getIndex());
  if (!editorState) {
    vscode.window.showWarningMessage("Open a source file inside a workspace before asking Vibe.");
    return undefined;
  }

  const question = overrideQuestion?.trim();
  if (!question) {
    return undefined;
  }

  try {
    return await executeAskAboutSelection(context, threadService, controller, editorState, question);
  } catch (error) {
    vscode.window.showErrorMessage(String(error));
    return undefined;
  }
}

function createSelectionComposer(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  controller: VibeController
): {
  open: () => Promise<void>;
} {
  const fallbackComposer = createPanelComposer(context, threadService, controller);

  let inlineInset: WebviewEditorInsetLike | undefined;
  let inlineSnapshot: EditorSelectionState | null = null;
  let inlineEditor: vscode.TextEditor | null = null;
  let inlineInsetLine = 0;
  let inlineDraft = "";
  let inlinePendingHydration: InlineHydrationPayload | null = null;
  let inlineReady = false;
  let inlineInFlight = false;

  const open = async (): Promise<void> => {
    const snapshot = captureSelectionSnapshot(indexService);
    if (!snapshot) {
      vscode.window.showWarningMessage("Open a source file inside a workspace before asking Vibe.");
      return;
    }

    const openedInline = await openInlineComposer(snapshot);
    if (openedInline) {
      fallbackComposer.dispose();
      return;
    }

    await fallbackComposer.open(snapshot.editorState);
  };

  const openInlineComposer = async (snapshot: SelectionSnapshot): Promise<boolean> => {
    if (!getCreateWebviewTextEditorInset()) {
      return false;
    }

    if (inlineInset) {
      inlineInset.dispose();
    }
    resetInlineSession();
    inlineSnapshot = snapshot.editorState;
    inlineEditor = snapshot.editor;
    inlineInsetLine = snapshot.insetLine;
    inlineDraft = "";

    const opened = await createInlineInset();
    if (!opened) {
      resetInlineSession();
    }
    return opened;
  };

  const createInlineInset = async (): Promise<boolean> => {
    const createInset = getCreateWebviewTextEditorInset();
    if (!createInset || !inlineEditor || !inlineSnapshot) {
      return false;
    }

    inlinePendingHydration = { draft: inlineDraft };
    inlineReady = false;

    try {
      const inset = createInset(
        inlineEditor,
        inlineInsetLine,
        INLINE_INSET_HEIGHT,
        { enableScripts: true }
      );
      inlineInset = inset;

      inset.webview.html = renderInlineComposerHtml(inset.webview);
      inset.onDidDispose(() => {
        if (inlineInset === inset) {
          resetInlineSession();
        }
      });
      inset.webview.onDidReceiveMessage((message: InlineComposerMessage) => {
        void handleInlineMessage(inset, message);
      });

      return true;
    } catch {
      return false;
    }
  };

  const handleInlineMessage = async (
    inset: WebviewEditorInsetLike,
    message: InlineComposerMessage
  ): Promise<void> => {
    if (!inlineInset || inlineInset !== inset) {
      return;
    }

    switch (message.type) {
      case "ready":
        inlineReady = true;
        if (inlinePendingHydration) {
          await inset.webview.postMessage({
            type: "hydrate",
            payload: inlinePendingHydration
          } satisfies ExtensionToComposerMessage);
          inlinePendingHydration = null;
        }
        return;
      case "cancel":
        inset.dispose();
        return;
      case "submit": {
        if (inlineInFlight) {
          return;
        }

        const question = message.payload?.question?.trim();
        if (!question) {
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Type a question before sending."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        if (!inlineSnapshot) {
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Selection context is unavailable. Reopen Ask About Selection and try again."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        inlineInFlight = true;
        try {
          const thread = await executeAskAboutSelection(context, threadService, controller, inlineSnapshot, question);
          if (thread) {
            inset.dispose();
          }
        } catch (error) {
          const errorText = String(error);
          vscode.window.showErrorMessage(errorText);
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: errorText
            }
          } satisfies ExtensionToComposerMessage);
        } finally {
          inlineInFlight = false;
        }
        return;
      }
      default:
        return;
    }
  };

  const resetInlineSession = (): void => {
    inlineInset = undefined;
    inlineSnapshot = null;
    inlineEditor = null;
    inlineInsetLine = 0;
    inlineDraft = "";
    inlinePendingHydration = null;
    inlineReady = false;
    inlineInFlight = false;
  };

  return { open };
}

function createPanelComposer(
  context: vscode.ExtensionContext,
  threadService: ThreadService,
  controller: VibeController
): {
  open: (editorState: EditorSelectionState) => Promise<void>;
  dispose: () => void;
} {
  let panel: vscode.WebviewPanel | undefined;
  let editorStateSnapshot: EditorSelectionState | null = null;
  let pendingHydration: PanelHydrationPayload | null = null;
  let ready = false;
  let inFlight = false;

  const open = async (editorState: EditorSelectionState): Promise<void> => {
    editorStateSnapshot = editorState;
    const hydratePayload = buildPanelHydrationPayload(editorState);
    pendingHydration = hydratePayload;

    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        "vibe.askComposer",
        "Ask About Selection",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      ready = false;
      panel.webview.html = renderPanelComposerHtml(panel.webview);
      panel.onDidDispose(() => {
        panel = undefined;
        editorStateSnapshot = null;
        pendingHydration = null;
        ready = false;
        inFlight = false;
      });
      panel.webview.onDidReceiveMessage((message: ComposerMessage) => {
        void handlePanelMessage(message);
      });
    } else {
      panel.reveal(vscode.ViewColumn.Active);
    }

    if (ready && panel) {
      await panel.webview.postMessage({
        type: "hydrate",
        payload: hydratePayload
      } satisfies ExtensionToComposerMessage);
      pendingHydration = null;
    }
  };

  const handlePanelMessage = async (message: ComposerMessage): Promise<void> => {
    if (!panel) {
      return;
    }

    switch (message.type) {
      case "ready":
        ready = true;
        if (pendingHydration) {
          await panel.webview.postMessage({
            type: "hydrate",
            payload: pendingHydration
          } satisfies ExtensionToComposerMessage);
          pendingHydration = null;
        }
        return;
      case "cancel":
        panel.dispose();
        return;
      case "submit": {
        if (inFlight) {
          return;
        }

        const question = message.payload?.question?.trim();
        if (!question) {
          await panel.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Type a question before sending."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        if (!editorStateSnapshot) {
          await panel.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Selection context is unavailable. Reopen Ask About Selection and try again."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        inFlight = true;
        try {
          const thread = await executeAskAboutSelection(context, threadService, controller, editorStateSnapshot, question);
          if (thread) {
            panel.dispose();
          }
        } catch (error) {
          const errorText = String(error);
          vscode.window.showErrorMessage(errorText);
          if (panel) {
            await panel.webview.postMessage({
              type: "submitResult",
              payload: {
                ok: false,
                error: errorText
              }
            } satisfies ExtensionToComposerMessage);
          }
        } finally {
          inFlight = false;
        }
        return;
      }
      default:
        return;
    }
  };

  const dispose = (): void => {
    if (panel) {
      panel.dispose();
    }
  };

  return { open, dispose };
}

function captureSelectionSnapshot(indexService: IndexService): SelectionSnapshot | null {
  const editorState = getActiveSelectionState(indexService.getIndex());
  const editor = vscode.window.activeTextEditor;
  if (!editorState || !editor) {
    return null;
  }

  return {
    editor,
    editorState,
    insetLine: Math.max(0, editor.selection.start.line - 1)
  };
}

function getCreateWebviewTextEditorInset(): CreateWebviewTextEditorInset | undefined {
  return (
    vscode.window as unknown as {
      createWebviewTextEditorInset?: CreateWebviewTextEditorInset;
    }
  ).createWebviewTextEditorInset;
}

async function executeAskAboutSelection(
  context: vscode.ExtensionContext,
  threadService: ThreadService,
  controller: VibeController,
  editorState: EditorSelectionState,
  question: string
): Promise<Thread | undefined> {
  const modelConfig = await ensureModelConfigured(context, "ask");
  if (!modelConfig) {
    return undefined;
  }

  const thread = await threadService.askQuestion(question, editorState, modelConfig, {
    onThreadCreated: async (createdThread) => {
      await controller.openThread(createdThread.id);
    }
  });
  return thread;
}

function buildPanelHydrationPayload(editorState: EditorSelectionState): PanelHydrationPayload {
  return {
    suggestion: editorState.selectedText
      ? "Explain this code and its surrounding behavior"
      : "Explain the current symbol",
    contextLabel: `${editorState.activeFile}:${editorState.startLine}-${editorState.endLine}`,
    selectionPreview: compactSelectionPreview(editorState.selectedText)
  };
}

function compactSelectionPreview(selectedText: string): string {
  const compact = selectedText.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "No selection preview available.";
  }

  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}

function renderInlineComposerHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Ask About Selection</title>
    <style>
      :root {
        color-scheme: light dark;
        --inline-right-safe: 120px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 8px 10px;
        overflow: hidden;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }

      .shell {
        display: grid;
        gap: 6px;
        width: calc(100% - var(--inline-right-safe));
        max-width: calc(100% - var(--inline-right-safe));
        min-width: 320px;
        margin-right: var(--inline-right-safe);
      }

      @media (max-width: 520px) {
        .shell {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin-right: 0;
        }
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      input[type="text"] {
        flex: 1;
        min-width: 0;
        height: 34px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 0 10px;
        font: inherit;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
      }

      button {
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 6px;
        height: 34px;
        padding: 0 12px;
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .error {
        min-height: 14px;
        margin: 0;
        color: var(--vscode-errorForeground);
        font-size: 11px;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="row">
        <input id="questionInput" type="text" placeholder="Press Enter to send, Esc to cancel" />
        <button id="sendButton" type="button">Send</button>
      </div>
      <p class="error" id="errorText"></p>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const questionInput = document.getElementById("questionInput");
      const sendButton = document.getElementById("sendButton");
      const errorText = document.getElementById("errorText");
      let isSending = false;

      function setSending(next) {
        isSending = next;
        sendButton.disabled = next;
      }

      function submitQuestion() {
        if (isSending) {
          return;
        }

        const question = questionInput.value.trim();
        if (!question) {
          errorText.textContent = "Type a question before sending.";
          return;
        }

        errorText.textContent = "";
        setSending(true);
        vscode.postMessage({
          type: "submit",
          payload: { question: questionInput.value }
        });
      }

      sendButton.addEventListener("click", submitQuestion);
      questionInput.addEventListener("input", () => {
        if (errorText.textContent) {
          errorText.textContent = "";
        }
      });

      questionInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitQuestion();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.type === "hydrate") {
          questionInput.value = message.payload.draft || "";
          setSending(false);
          errorText.textContent = "";
          questionInput.focus();
          questionInput.setSelectionRange(questionInput.value.length, questionInput.value.length);
        }

        if (message.type === "submitResult") {
          if (!message.payload.ok) {
            errorText.textContent = message.payload.error || "Failed to send question.";
            setSending(false);
          }
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function renderPanelComposerHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Ask About Selection</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 16px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }

      .shell {
        display: grid;
        gap: 10px;
      }

      .label {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }

      .context {
        margin: 0;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
        font-family: var(--vscode-editor-font-family, Consolas, monospace);
        font-size: 12px;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
      }

      textarea {
        width: 100%;
        min-height: 78px;
        resize: vertical;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 10px;
        font: inherit;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .hint {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .spacer {
        flex: 1;
      }

      button {
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 6px;
        padding: 6px 12px;
        font: inherit;
        cursor: pointer;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .error {
        min-height: 16px;
        margin: 0;
        color: var(--vscode-errorForeground);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div>
        <p class="label">Selection Snapshot</p>
        <p class="context" id="contextLabel"></p>
        <p class="context" id="selectionPreview"></p>
      </div>

      <div>
        <p class="label">Question</p>
        <textarea id="questionInput" placeholder="Ask what you want to understand about this selection"></textarea>
      </div>

      <p class="error" id="errorText"></p>

      <div class="row">
        <p class="hint">Enter to send, Shift+Enter for newline, Esc to cancel</p>
        <div class="spacer"></div>
        <button id="sendButton" type="button">Send</button>
      </div>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const contextLabel = document.getElementById("contextLabel");
      const selectionPreview = document.getElementById("selectionPreview");
      const questionInput = document.getElementById("questionInput");
      const sendButton = document.getElementById("sendButton");
      const errorText = document.getElementById("errorText");
      let isSending = false;

      function setSending(next) {
        isSending = next;
        sendButton.disabled = next;
      }

      function submitQuestion() {
        if (isSending) {
          return;
        }

        const question = questionInput.value.trim();
        if (!question) {
          errorText.textContent = "Type a question before sending.";
          return;
        }

        errorText.textContent = "";
        setSending(true);
        vscode.postMessage({
          type: "submit",
          payload: { question: questionInput.value }
        });
      }

      sendButton.addEventListener("click", submitQuestion);

      questionInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitQuestion();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.type === "hydrate") {
          contextLabel.textContent = message.payload.contextLabel;
          selectionPreview.textContent = message.payload.selectionPreview;
          questionInput.value = message.payload.suggestion;
          errorText.textContent = "";
          setSending(false);
          questionInput.focus();
          questionInput.setSelectionRange(questionInput.value.length, questionInput.value.length);
        }

        if (message.type === "submitResult") {
          if (!message.payload.ok) {
            errorText.textContent = message.payload.error || "Failed to send question.";
            setSending(false);
          }
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function createNonce(length = 24): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return value;
}
