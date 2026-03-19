import * as vscode from "vscode";

import type { IndexService } from "../services/indexService";
import type { ThreadService } from "../services/threadService";
import type { VibeController } from "../services/vibeController";

import { askAboutSelection } from "./askAboutSelection";

export function registerExplainCurrentSymbolCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  controller: VibeController
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vibe.explainCurrentSymbol", async (_nodeId?: string) => {
      await askAboutSelection(
        context,
        indexService,
        threadService,
        controller,
        "Explain the current symbol, its dependencies, and any uncertainty from the available evidence."
      );
    })
  );
}
