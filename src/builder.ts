import * as vscode from "vscode";
import { getActiveBoard, selectBoard } from "./boardConfig";

export async function build(): Promise<vscode.TaskExecution | undefined> {
  const board = getActiveBoard() ?? (await selectBoard());
  if (!board) { return; }

  const task = new vscode.Task(
    { type: "cargo", task: "build" },
    vscode.TaskScope.Workspace,
    "cargo build",
    "rdyno",
    new vscode.ShellExecution("cargo", [
      "build",
      "--release",
      "--target", board.board.target,
    ])
  );
  return vscode.tasks.executeTask(task);
}