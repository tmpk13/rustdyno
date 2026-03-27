import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";
import { getGlobalBoardsDir } from "./boardLibrary";

export interface NewProjectFile {
  path: string;
  content: string;
  replace_if_exists?: boolean;
  append_if_exists?: boolean;
}

export interface GenerateCommand {
  label: string;
  command: string;
}

export interface NewProjectConfig {
  /** Files to create when generating a new project from this board config */
  files?: NewProjectFile[];
  /** Optional cargo dependencies to append to Cargo.toml */
  dependencies?: string;
  /** Optional cargo build-dependencies to append to Cargo.toml */
  "build-dependencies"?: string;
  /** Optional .cargo/config.toml runner line */
  runner?: string;
  /** Optional generate command(s) — string for one, array of {label, command} for multiple */
  generate?: string | GenerateCommand[];
}

export interface ToolInstallConfig {
  /** Name of the CLI tool (e.g. "probe-rs", "espflash") */
  name: string;
  /** Command to check if the tool exists (e.g. "probe-rs --version") */
  check?: string;
  /** Install commands per platform */
  install?: {
    linux?: string;
    mac?: string;
    win?: string;
  };
  /** Message shown after successful install (e.g. "Restart your terminal") */
  success_message?: string;
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
  board: { name: string; chip: string; target: string; elf?: string };
  probe?: { protocol: string; speed: number; port?: string };
  flash: Record<string, unknown>;
  rtt: { enabled: boolean; channels: { up: number; name: string }[]; command?: string };
  run?: { command?: string };
  tool?: ToolInstallConfig;
  new_project?: NewProjectConfig;
  actions?: Record<string, ActionConfig>;
  layout?: PanelLayout;
}

let activeBoard: BoardConfig | undefined;
let activeBoardFile: string | undefined;
let activeBoardPath: string | undefined;
let portOverride: string | undefined;

export function ensureBoardDir(_extensionPath: string): void {
  // No-op: .rustdyno is now created explicitly via setupBoardDir() or new project creation
}

export function setupBoardDir(extensionPath: string): void {
  const dir = getBoardDir();
  if (fs.existsSync(dir)) { return; }
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(extensionPath, "boards", "esp32c3.toml");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dir, "esp32c3.toml"));
  }
}

export function getBoardDir(): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configDir = vscode.workspace.getConfiguration("rustdyno").get<string>("boardConfigDir", ".rustdyno");
  return path.join(wsRoot ?? ".", configDir);
}

function pickerTomlPath(): string {
  return path.join(getBoardDir(), "rustdyno.toml");
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

export function getPanelBg(): string | undefined {
  const data = readRdynoToml();
  return typeof data.panel_bg === "string" ? data.panel_bg : undefined;
}

export function setPanelBg(color: string | undefined): void {
  const data = readRdynoToml();
  if (color) {
    data.panel_bg = color;
  } else {
    delete data.panel_bg;
  }
  writeRdynoToml(data);
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

export interface BinTarget {
  name: string;
  path: string;
}

export function getCargoTargets(): BinTarget[] {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) { return []; }
  const cargoPath = path.join(wsRoot, "Cargo.toml");
  if (!fs.existsSync(cargoPath)) { return []; }
  try {
    const cargo = TOML.parse(fs.readFileSync(cargoPath, "utf-8")) as {
      package?: { name?: string };
      bin?: Array<{ name: string; path?: string }>;
    };
    const targets: BinTarget[] = [];

    // Implicit default bin from src/main.rs
    if (fs.existsSync(path.join(wsRoot, "src", "main.rs"))) {
      const pkgName = cargo.package?.name ?? "main";
      targets.push({ name: pkgName, path: "src/main.rs" });
    }

    // Explicit [[bin]] sections
    if (Array.isArray(cargo.bin)) {
      for (const bin of cargo.bin) {
        const binPath = bin.path ?? `src/bin/${bin.name}.rs`;
        if (!targets.some(t => t.path === binPath)) {
          targets.push({ name: bin.name, path: binPath });
        }
      }
    }

    return targets;
  } catch {
    return [];
  }
}

export function getLayout(): PanelLayout | undefined {
  const layout = activeBoard?.layout;
  if (!layout) { return undefined; }
  return {
    order: Array.isArray(layout.order) ? layout.order : [],
    hidden: Array.isArray(layout.hidden) ? layout.hidden : [],
  };
}

export function setBoardElf(elf: string): void {
  if (!activeBoardPath || !activeBoard) { return; }
  activeBoard.board.elf = elf;
  let data: TOML.JsonMap;
  try { data = TOML.parse(fs.readFileSync(activeBoardPath, "utf-8")) as TOML.JsonMap; }
  catch { data = {}; }
  (data.board as TOML.JsonMap).elf = elf;
  fs.writeFileSync(activeBoardPath, TOML.stringify(data), "utf-8");
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
      if (f.endsWith(".toml") && f !== "picker.toml" && f !== "rustdyno.toml" && !seen.has(f)) {
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

export interface ProbeMapping {
  name?: string;
  board?: string;
}

export function getProbeMap(): Record<string, ProbeMapping> {
  const data = readRdynoToml();
  const probesRaw = data.probes;
  if (!probesRaw || typeof probesRaw !== 'object' || Array.isArray(probesRaw)) { return {}; }
  const result: Record<string, ProbeMapping> = {};
  for (const [id, val] of Object.entries(probesRaw as Record<string, unknown>)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      result[id] = {
        name: typeof v.name === 'string' ? v.name : undefined,
        board: typeof v.board === 'string' ? v.board : undefined,
      };
    }
  }
  return result;
}

export function setProbeMapping(probeId: string, name: string, boardFile?: string): void {
  const data = readRdynoToml();
  const probesRaw = data.probes;
  const probes = (probesRaw && typeof probesRaw === 'object' && !Array.isArray(probesRaw)
    ? probesRaw : {}) as TOML.JsonMap;
  const existingRaw = probes[probeId];
  const existing = (existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
    ? existingRaw : {}) as TOML.JsonMap;
  existing.name = name;
  if (boardFile !== undefined) { existing.board = boardFile; }
  probes[probeId] = existing;
  data.probes = probes;
  writeRdynoToml(data);
}

export function clearProbeBoard(probeId: string): void {
  const data = readRdynoToml();
  const probesRaw = data.probes;
  if (!probesRaw || typeof probesRaw !== 'object' || Array.isArray(probesRaw)) { return; }
  const probes = probesRaw as TOML.JsonMap;
  const existingRaw = probes[probeId];
  if (existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)) {
    const existing = existingRaw as TOML.JsonMap;
    delete existing.board;
    probes[probeId] = existing;
    writeRdynoToml(data);
  }
}
