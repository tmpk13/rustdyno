import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";

export interface BoardConfig {
  board: { name: string; chip: string; target: string };
  probe: { protocol: string; speed: number };
  flash: Record<string, unknown>;
  rtt: { enabled: boolean; channels: { up: number; name: string }[] };
}

let activeBoard: BoardConfig | undefined;
let activeBoardFile: string | undefined;

function getBoardDir(): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configDir = vscode.workspace.getConfiguration("embeddedRust").get<string>("boardConfigDir", ".boards");
  return path.join(wsRoot ?? ".", configDir);
}

export function listBoards(): string[] {
  const dir = getBoardDir();
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir).filter((f) => f.endsWith(".toml") && f !== "picker.toml");
}

export function selectBoardByFile(filename: string): BoardConfig | undefined {
  const dir = getBoardDir();
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`Board config not found: ${filePath}`);
    return;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  activeBoard = TOML.parse(raw) as unknown as BoardConfig;
  activeBoardFile = filename;
  return activeBoard;
}

export async function selectBoard(): Promise<BoardConfig | undefined> {
  const dir = getBoardDir();
  if (!fs.existsSync(dir)) {
    vscode.window.showErrorMessage(`Board config dir not found: ${dir}`);
    return;
  }

  const files = listBoards();
  const pick = await vscode.window.showQuickPick(files, { placeHolder: "Select board config" });
  if (!pick) { return; }

  activeBoard = selectBoardByFile(pick);
  if (activeBoard) {
    vscode.window.showInformationMessage(`Board: ${activeBoard.board.name}`);
  }
  return activeBoard;
}

export function getActiveBoard(): BoardConfig | undefined {
  return activeBoard;
}

export function getActiveBoardFile(): string | undefined {
  return activeBoardFile;
}
