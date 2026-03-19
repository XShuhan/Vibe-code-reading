import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { Thread } from "@code-vibe/shared";

import type { ThreadService } from "../services/threadService";

export function registerDeleteThreadCommand(
  context: vscode.ExtensionContext,
  threadService: ThreadService,
  getSelectedThread: () => Thread | undefined
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.deleteThread, async (threadArg?: Thread) => {
      const thread = threadArg ?? getSelectedThread();
      if (!thread) {
        return;
      }

      const deleted = await threadService.deleteThread(thread.id);
      if (!deleted) {
        return;
      }
    })
  );
}
