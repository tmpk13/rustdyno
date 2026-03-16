import * as vscode from "vscode";
import { selectBoard, ensureBoardDir } from "./boardConfig";
import { initBoardLibrary } from "./boardLibrary";
import { build } from "./builder";
import { flash } from "./flasher";
import { startRtt } from "./rtt";
import { newProject } from "./newProject";
import { BoardPanelProvider, NewProjectPanelProvider, BoardLibraryPanelProvider } from "./panel";


export function activate(ctx: vscode.ExtensionContext) {
  initBoardLibrary(ctx.globalStorageUri.fsPath);
  ensureBoardDir();
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rdyno.selectBoard", selectBoard),
    vscode.commands.registerCommand("rdyno.build", build),
    vscode.commands.registerCommand("rdyno.flash", flash),
    vscode.commands.registerCommand("rdyno.rtt", startRtt),
    vscode.commands.registerCommand("rdyno.newProject", newProject),
  );
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BoardPanelProvider.viewType,
      new BoardPanelProvider(ctx)
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