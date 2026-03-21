import * as vscode from "vscode";
import { selectBoard } from "./boardConfig";
import { initBoardLibrary } from "./boardLibrary";
import { build } from "./builder";
import { flash } from "./flasher";
import { startRtt } from "./rtt";
import { newProject } from "./newProject";
import { BoardPanelProvider, NewProjectPanelProvider, BoardLibraryPanelProvider } from "./panel";


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
    vscode.window.registerWebviewViewProvider(
      NewProjectPanelProvider.viewType,
      new NewProjectPanelProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.registerWebviewViewProvider(
      BoardLibraryPanelProvider.viewType,
      new BoardLibraryPanelProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
  );
}

export function deactivate() {}