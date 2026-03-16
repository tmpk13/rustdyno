import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";

export interface NewProjectFile {
  path: string;
  content: string;
}

export interface NewProjectConfig {
  /** Files to create when generating a new project from this board config */
  files?: NewProjectFile[];
  /** Optional cargo dependencies to add to Cargo.toml */
  dependencies?: Record<string, string>;
  /** Optional .cargo/config.toml runner line */
  runner?: string;
}

export interface BoardConfig {
  board: { name: string; chip: string; target: string };
  probe: { protocol: string; speed: number; port?: string };
  flash: Record<string, unknown>;
  rtt: { enabled: boolean; channels: { up: number; name: string }[] };
  run?: { command?: string };
  new_project?: NewProjectConfig;
}

let activeBoard: BoardConfig | undefined;
let activeBoardFile: string | undefined;
let portOverride: string | undefined;

const DEFAULT_BOARD_TOML = `[board]
name   = "STM32F411 BlackPill"
chip   = "STM32F411CEUx"
target = "thumbv7em-none-eabihf"

[probe]
protocol = "Swd"
speed    = 4000   # kHz

[flash]

[rtt]
enabled  = true
channels = [{ up = 0, name = "Terminal" }]
`;

export function ensureBoardDir(): void {
  const dir = getBoardDir();
  if (fs.existsSync(dir)) { return; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "stm32f4.toml"), DEFAULT_BOARD_TOML, "utf-8");
}

function getBoardDir(): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configDir = vscode.workspace.getConfiguration("embeddedRust").get<string>("boardConfigDir", ".rdyno");
  return path.join(wsRoot ?? ".", configDir);
}

function pickerTomlPath(): string {
  return path.join(getBoardDir(), "rdyno.toml");
}

export function getDefaultBoardFile(): string | undefined {
  const p = pickerTomlPath();
  if (!fs.existsSync(p)) { return undefined; }
  try {
    const parsed = TOML.parse(fs.readFileSync(p, "utf-8")) as { default?: string };
    return parsed.default;
  } catch { return undefined; }
}

export function setDefaultBoardFile(filename: string): void {
  const dir = getBoardDir();
  if (!fs.existsSync(dir)) { return; }
  fs.writeFileSync(pickerTomlPath(), `default = ${JSON.stringify(filename)}\n`, "utf-8");
}

export function autoSelectBoard(): BoardConfig | undefined {
  const boards = listBoards();
  if (boards.length === 0) { return undefined; }
  const defaultFile = getDefaultBoardFile();
  const toSelect = (defaultFile && boards.includes(defaultFile)) ? defaultFile : boards[0];
  return selectBoardByFile(toSelect);
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

export function getPortOverride(): string | undefined {
  return portOverride;
}

export function setPortOverride(port: string | undefined): void {
  portOverride = port;
}

export function getEffectivePort(): string | undefined {
  return portOverride ?? activeBoard?.probe?.port;
}
