import * as vscode from "vscode";
import { selectBoard } from "./boardConfig";
import { initBoardLibrary } from "./boardLibrary";
import { build } from "./builder";
import { flash } from "./flasher";
import { startRtt } from "./rtt";
import { newProject } from "./newProject";
import { BoardPanelProvider } from "./panel";


export function activate(ctx: vscode.ExtensionContext) {
  initBoardLibrary(ctx.globalStorageUri.fsPath);
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rustdyno.selectBoard", selectBoard),
    vscode.commands.registerCommand("rustdyno.build", build),
    vscode.commands.registerCommand("rustdyno.flash", flash),
    vscode.commands.registerCommand("rustdyno.rtt", startRtt),
    vscode.commands.registerCommand("rustdyno.newProject", newProject),
  );
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BoardPanelProvider.viewType,
      new BoardPanelProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
  );
}

export function deactivate() {}