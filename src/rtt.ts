import * as vscode from "vscode";
import { getActiveBoard, getEffectivePort } from "./boardConfig";
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
  const port = getEffectivePort();
  const portFlag = port ? ` --probe ${port}` : "";
  rttTerminal.sendText(`${probePath} attach --chip ${board.board.chip} --protocol ${board.probe.protocol}${portFlag}`);
}