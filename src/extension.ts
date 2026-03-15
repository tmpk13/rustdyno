import * as vscode from "vscode";
import { selectBoard } from "./boardConfig";
import { build } from "./builder";
import { flash } from "./flasher";
import { startRtt } from "./rtt";
import { newProject } from "./newProject";
import { BoardPanelProvider, NewProjectPanelProvider } from "./panel";


export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("embeddedRust.selectBoard", selectBoard),
    vscode.commands.registerCommand("embeddedRust.build", build),
    vscode.commands.registerCommand("embeddedRust.flash", flash),
    vscode.commands.registerCommand("embeddedRust.rtt", startRtt),
    vscode.commands.registerCommand("embeddedRust.newProject", newProject),
  );
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BoardPanelProvider.viewType,
      new BoardPanelProvider(ctx)
    ),
    vscode.window.registerWebviewViewProvider(
      NewProjectPanelProvider.viewType,
      new NewProjectPanelProvider(ctx)
    ),
  );
}

export function deactivate() {}