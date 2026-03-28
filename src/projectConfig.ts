import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";

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

// ── Panel config ──

export interface TabConfig {
  vertical: boolean;
  auto_collapse_seconds: number;
}

const TAB_CONFIG_DEFAULTS: TabConfig = { vertical: true, auto_collapse_seconds: 5 };

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

export function getTabConfig(): TabConfig {
  const data = readRdynoToml();
  return {
    vertical: typeof data.tabs_vertical === "boolean" ? data.tabs_vertical : TAB_CONFIG_DEFAULTS.vertical,
    auto_collapse_seconds: typeof data.tabs_auto_collapse_seconds === "number" ? data.tabs_auto_collapse_seconds : TAB_CONFIG_DEFAULTS.auto_collapse_seconds,
  };
}

export function setTabConfig(cfg: Partial<TabConfig>): void {
  const data = readRdynoToml();
  if (cfg.vertical !== undefined) { data.tabs_vertical = cfg.vertical; }
  if (cfg.auto_collapse_seconds !== undefined) { data.tabs_auto_collapse_seconds = cfg.auto_collapse_seconds; }
  writeRdynoToml(data);
}

// ── Project config ──

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
