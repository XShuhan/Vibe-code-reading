import * as vscode from "vscode";

import type { IndexService } from "../services/indexService";
import type { ProjectOverviewService } from "../services/projectOverviewService";

export function registerRefreshIndexCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  projectOverviewService: ProjectOverviewService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vibe.refreshIndex", async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing Vibe index",
            cancellable: false
          },
          async (progress) => {
            progress.report({ message: "Indexing workspace..." });
            const index = await indexService.refresh("manual");

            progress.report({ message: "Generating AI project overview..." });
            await projectOverviewService.refresh("manual", index);
          }
        );

        vscode.window.showInformationMessage("Vibe index and project overview refreshed.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(`Vibe refresh finished with an overview error: ${message}`);
      }
    })
  );
}
