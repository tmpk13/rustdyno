import * as vscode from "vscode";
import { getActiveBoard, getEffectivePort, selectBoard } from "./boardConfig";

export async function flash(): Promise<void> {
  const board = getActiveBoard() ?? (await selectBoard());
  if (!board) { return; }

  const probePath = vscode.workspace.getConfiguration("rdyno").get<string>("probersPath", "probe-rs");
  const port = getEffectivePort();
  const portFlag = port ? ` --probe ${port}` : "";

  const terminal = vscode.window.createTerminal("Flash");
  terminal.show();

  if (board.run?.command) {
    terminal.sendText(board.run.command);
  } else {
    // Resolve ELF — convention: target/<target>/release/<crate-name>
    terminal.sendText(
      `${probePath} run --chip ${board.board.chip}` +
      ` --protocol ${board.probe.protocol}` +
      ` --speed ${board.probe.speed}` +
      portFlag +
      ` target/${board.board.target}/release/<CRATE_NAME>`
      // TODO: resolve crate name from Cargo.toml
    );
  }
}