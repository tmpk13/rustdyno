import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";
import { getGlobalBoardsDir } from "./boardLibrary";

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

export interface ActionConfig {
  label?: string;
  color?: string;
}

export interface PanelLayout {
  order: string[];
  hidden: string[];
}

export interface BoardConfig {
  board: { name: string; chip: string; target: string };
  probe: { protocol: string; speed: number; port?: string };
  flash: Record<string, unknown>;
  rtt: { enabled: boolean; channels: { up: number; name: string }[] };
  run?: { command?: string };
  new_project?: NewProjectConfig;
  actions?: Record<string, ActionConfig>;
  layout?: PanelLayout;
}

let activeBoard: BoardConfig | undefined;
let activeBoardFile: string | undefined;
let activeBoardPath: string | undefined;
let portOverride: string | undefined;

const DEFAULT_BOARD_TOML = `[board]
name   = "ESP32-C3"
chip   = "esp32c3"
target = "riscv32imc-unknown-none-elf"

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
  fs.writeFileSync(path.join(dir, "esp32c3.toml"), DEFAULT_BOARD_TOML, "utf-8");
}

function getBoardDir(): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configDir = vscode.workspace.getConfiguration("rdyno").get<string>("boardConfigDir", ".rdyno");
  return path.join(wsRoot ?? ".", configDir);
}

function pickerTomlPath(): string {
  return path.join(getBoardDir(), "rdyno.toml");
}

function readRdynoToml(): TOML.JsonMap {
  const p = pickerTomlPath();
  if (!fs.existsSync(p)) { return {}; }
  try {
    return TOML.parse(fs.readFileSync(p, "utf-8")) as TOML.JsonMap;
  } catch { return {}; }
}

function writeRdynoToml(data: TOML.JsonMap): void {
  const dir = getBoardDir();
  if (!fs.existsSync(dir)) { return; }
  fs.writeFileSync(pickerTomlPath(), TOML.stringify(data), "utf-8");
}

export function getDefaultBoardFile(): string | undefined {
  const data = readRdynoToml();
  return typeof data.default === "string" ? data.default : undefined;
}

export function setDefaultBoardFile(filename: string): void {
  const data = readRdynoToml();
  data.default = filename;
  writeRdynoToml(data);
}

export function getDefaultTargetFile(): string | undefined {
  const data = readRdynoToml();
  return typeof data.target === "string" ? data.target : undefined;
}

export function setDefaultTargetFile(relativePath: string): void {
  const data = readRdynoToml();
  data.target = relativePath;
  writeRdynoToml(data);
}

export function getLayout(): PanelLayout | undefined {
  const layout = activeBoard?.layout;
  if (!layout) { return undefined; }
  return {
    order: Array.isArray(layout.order) ? layout.order : [],
    hidden: Array.isArray(layout.hidden) ? layout.hidden : [],
  };
}

export function setLayout(layout: PanelLayout): void {
  if (!activeBoardPath || !activeBoard) { return; }
  activeBoard.layout = layout;
  let data: TOML.JsonMap;
  try { data = TOML.parse(fs.readFileSync(activeBoardPath, "utf-8")) as TOML.JsonMap; }
  catch { data = {}; }
  data.layout = layout as unknown as TOML.JsonMap;
  fs.writeFileSync(activeBoardPath, TOML.stringify(data), "utf-8");
}

export function autoSelectBoard(): BoardConfig | undefined {
  const boards = listBoards();
  if (boards.length === 0) { return undefined; }
  const defaultFile = getDefaultBoardFile();
  const toSelect = (defaultFile && boards.includes(defaultFile)) ? defaultFile : boards[0];
  return selectBoardByFile(toSelect);
}

export function listBoards(): string[] {
  const dirs = [getBoardDir(), getGlobalBoardsDir()].filter(Boolean) as string[];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) { continue; }
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".toml") && f !== "picker.toml" && f !== "rdyno.toml" && !seen.has(f)) {
        seen.add(f);
        result.push(f);
      }
    }
  }
  return result;
}

export function selectBoardByFile(filename: string): BoardConfig | undefined {
  const wsPath = path.join(getBoardDir(), filename);
  const globalDir = getGlobalBoardsDir();
  const globalPath = globalDir ? path.join(globalDir, filename) : undefined;
  const filePath = fs.existsSync(wsPath) ? wsPath : (globalPath && fs.existsSync(globalPath) ? globalPath : wsPath);
  if (!fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`Board config not found: ${filePath}`);
    return;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  activeBoard = TOML.parse(raw) as unknown as BoardConfig;
  activeBoardFile = filename;
  activeBoardPath = filePath;
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
