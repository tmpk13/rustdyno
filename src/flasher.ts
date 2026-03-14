import * as vscode from "vscode";
import { getActiveBoard, selectBoard } from "./boardConfig";

export async function flash(): Promise<void> {
  const board = getActiveBoard() ?? (await selectBoard());
  if (!board) { return; }

  const probePath = vscode.workspace.getConfiguration("embeddedRust").get<string>("probersPath", "probe-rs");

  // Resolve ELF — convention: target/<target>/release/<crate-name>
  const terminal = vscode.window.createTerminal("Flash");
  terminal.show();
  terminal.sendText(
    `${probePath} run --chip ${board.board.chip}` +
    ` --protocol ${board.probe.protocol}` +
    ` --speed ${board.probe.speed}` +
    ` target/${board.board.target}/release/<CRATE_NAME>`
    // TODO: resolve crate name from Cargo.toml
  );
}