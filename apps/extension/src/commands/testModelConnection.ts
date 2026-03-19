import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import { testModelConnection } from "@code-vibe/model-gateway";

import { assertModelConfigured, ensureModelConfigured } from "../config/settings";

export function registerTestModelConnectionCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.testModelConnection, async () => {
      const modelConfig = await ensureModelConfigured(context, "command");
      if (!modelConfig) {
        return;
      }

      try {
        assertModelConfigured(modelConfig);
        output.show(true);
        output.appendLine("[model] starting connection test");
        output.appendLine(`[model] provider=${modelConfig.provider}`);
        output.appendLine(`[model] baseUrl=${modelConfig.baseUrl}`);
        output.appendLine(`[model] model=${modelConfig.model}`);
        output.appendLine(`[model] apiKey=${maskSecret(modelConfig.apiKey)}`);

        const result = await testModelConnection(modelConfig);
        output.appendLine(
          `[model] available_models=${result.availableModels.map((item) => item.id).join(", ")}`
        );
        output.appendLine(`[model] response=${JSON.stringify(result.content)}`);

        vscode.window.showInformationMessage(`Model connection OK: ${result.model}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.show(true);
        output.appendLine(`[model] connection test failed: ${message}`);
        vscode.window.showErrorMessage(message);
      }
    })
  );
}

function maskSecret(secret: string): string {
  if (!secret) {
    return "(empty)";
  }

  if (secret.length <= 8) {
    return "*".repeat(secret.length);
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
