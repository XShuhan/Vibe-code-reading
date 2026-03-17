import * as vscode from "vscode";

import { COMMANDS, VIEWS } from "@code-vibe/shared";
import { createWorkspacePersistence, ensureWorkspaceStorage } from "@code-vibe/persistence";

import { VibeCodeLensProvider } from "./editor/codeLensProvider";
import { openCitation } from "./editor/sourceJump";
import { registerAddThreadAnswerToCanvasCommand } from "./commands/addThreadAnswerToCanvas";
import { registerAskAboutSelectionCommand } from "./commands/askAboutSelection";
import { registerExplainCurrentSymbolCommand } from "./commands/explainCurrentSymbol";
import { registerOpenCanvasCommand } from "./commands/openCanvas";
import { registerOpenProjectOverviewCommand } from "./commands/openProjectOverview";
import { registerRefreshIndexCommand } from "./commands/refreshIndex";
import { registerSaveSelectionAsCardCommand } from "./commands/saveSelectionAsCard";
import { registerTestModelConnectionCommand } from "./commands/testModelConnection";
import { registerTraceCallPathCommand } from "./commands/traceCallPath";
import { CardService } from "./services/cardService";
import { CanvasService } from "./services/canvasService";
import { IndexService } from "./services/indexService";
import { ThreadService } from "./services/threadService";
import { VibeController } from "./services/vibeController";
import { CardsViewProvider } from "./views/cardsView";
import { MapViewProvider } from "./views/mapView";
import { ThreadsViewProvider } from "./views/threadsView";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Code Vibe Reading");
  context.subscriptions.push(output);

  // 检查工作区
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    // 注册基本的 views（显示空状态）
    const emptyMapProvider = new MapViewProvider(null as any);
    const emptyThreadsProvider = new ThreadsViewProvider(null as any);
    const emptyCardsProvider = new CardsViewProvider(null as any);

    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(VIEWS.map, emptyMapProvider),
      vscode.window.registerTreeDataProvider(VIEWS.threads, emptyThreadsProvider),
      vscode.window.registerTreeDataProvider(VIEWS.cards, emptyCardsProvider)
    );

    vscode.window.showInformationMessage(
      "Code Vibe Reading: Open a workspace folder to start indexing."
    );
    return;
  }

  const storageUri =
    context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, "workspace");
  await ensureWorkspaceStorage(storageUri.fsPath);
  const persistence = createWorkspacePersistence(storageUri.fsPath, "workspace");

  const indexService = new IndexService(workspaceFolder.uri.fsPath, persistence, output);
  const threadService = new ThreadService(persistence, indexService, output);
  const cardService = new CardService(persistence, indexService);
  const canvasService = new CanvasService(persistence, indexService, cardService);

  await Promise.all([
    indexService.initialize(),
    threadService.initialize(),
    cardService.initialize(),
    canvasService.initialize()
  ]);

  const controller = new VibeController(
    context.extensionUri,
    indexService,
    threadService,
    cardService,
    canvasService
  );

  const mapViewProvider = new MapViewProvider(indexService);
  const threadsViewProvider = new ThreadsViewProvider(threadService);
  const cardsViewProvider = new CardsViewProvider(cardService);

  context.subscriptions.push(
    controller,
    vscode.window.registerTreeDataProvider(VIEWS.map, mapViewProvider),
    vscode.window.registerTreeDataProvider(VIEWS.threads, threadsViewProvider),
    vscode.window.registerTreeDataProvider(VIEWS.cards, cardsViewProvider),
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "typescriptreact" },
        { scheme: "file", language: "javascriptreact" },
        { scheme: "file", language: "python" },
        { scheme: "file", language: "shellscript" },
        { scheme: "file", language: "json" },
        { scheme: "file", language: "jsonc" }
      ],
      new VibeCodeLensProvider(indexService)
    ),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await indexService.refreshFile(document.uri);
    }),
    vscode.commands.registerCommand(COMMANDS.openThread, async (thread) => {
      await controller.openThread(thread.id);
    }),
    vscode.commands.registerCommand(COMMANDS.openCard, async (card) => {
      await controller.openCard(card.id);
    }),
    vscode.commands.registerCommand(COMMANDS.openCitation, async (citation) => {
      await openCitation(indexService.getRootPath(), citation);
    })
  );

  registerRefreshIndexCommand(context, indexService);
  registerTestModelConnectionCommand(context, output);
  registerAskAboutSelectionCommand(context, indexService, threadService, controller);
  registerExplainCurrentSymbolCommand(context, indexService, threadService, controller);
  registerSaveSelectionAsCardCommand(context, indexService, cardService, controller);
  registerAddThreadAnswerToCanvasCommand(context, threadService, cardService, canvasService, controller);
  registerOpenCanvasCommand(context, controller);
  registerOpenProjectOverviewCommand(context, indexService);
  registerTraceCallPathCommand(context, indexService, cardService, controller);
}

export function deactivate(): void {}
