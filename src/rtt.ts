import * as vscode from "vscode";
import { getActiveBoard } from "./boardConfig";
import { spawn } from "child_process";

let rttTerminal: vscode.Terminal | undefined;

export function startRtt(): void {
  const board = getActiveBoard();
  if (!board?.rtt?.enabled) {
    vscode.window.showWarningMessage("RTT not enabled for this board");
    return;
  }

  const probePath = vscode.workspace.getConfiguration("embeddedRust").get<string>("probersPath", "probe-rs");

  // Use pseudo-terminal for clean output
  rttTerminal?.dispose();
  rttTerminal = vscode.window.createTerminal("RTT");
  rttTerminal.show();
  rttTerminal.sendText(`${probePath} attach --chip ${board.board.chip} --protocol ${board.probe.protocol}`);
}