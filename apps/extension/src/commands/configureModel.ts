import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";

import { openApiConfiguration } from "../config/settings";

export function registerConfigureModelCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.configureModel, async () => {
      await openApiConfiguration(context);
    })
  );
}
