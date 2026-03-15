import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";

interface PickerConfig {
  hidden?: string[];
  order?: string[];
}

let cachedFiles: string[] = [];
let cachedHidden: string[] = [];
let activeFile: string | undefined;

function getPickerConfigPath(): string | undefined {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) { return undefined; }
  const configDir = vscode.workspace.getConfiguration("embeddedRust").get<string>("boardConfigDir", ".rdyno");
  return path.join(wsRoot, configDir, "rdyno.toml");
}

function loadConfig(): PickerConfig {
  const cfgPath = getPickerConfigPath();
  if (!cfgPath || !fs.existsSync(cfgPath)) { return {}; }
  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    return TOML.parse(raw) as unknown as PickerConfig;
  } catch {
    return {};
  }
}

function saveConfig(cfg: PickerConfig): void {
  const cfgPath = getPickerConfigPath();
  if (!cfgPath) { return; }
  fs.writeFileSync(cfgPath, TOML.stringify(cfg as unknown as TOML.JsonMap), "utf-8");
}

export async function refreshFiles(): Promise<void> {
  const globs = vscode.workspace.getConfiguration("embeddedRust").get<string[]>("pickerGlobs", []);
  if (!globs.length) {
    cachedFiles = [];
    cachedHidden = [];
    return;
  }

  const cfg = loadConfig();
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const seen = new Set<string>();
  const all: string[] = [];
  for (const glob of globs) {
    const found = await vscode.workspace.findFiles(glob);
    for (const u of found) {
      const r = path.relative(wsRoot, u.fsPath);
      if (!seen.has(r)) {
        seen.add(r);
        all.push(r);
      }
    }
  }

  const hiddenSet = new Set(cfg.hidden ?? []);
  const order = cfg.order ?? [];
  const orderMap = new Map(order.map((f, i) => [f, i]));

  cachedHidden = all.filter(f => hiddenSet.has(f));
  const visible = all.filter(f => !hiddenSet.has(f));
  cachedFiles = visible.sort((a, b) => {
    const ai = orderMap.has(a) ? orderMap.get(a)! : Infinity;
    const bi = orderMap.has(b) ? orderMap.get(b)! : Infinity;
    return ai !== bi ? ai - bi : a.localeCompare(b);
  });
}

export function openFile(relativePath: string): void {
  activeFile = relativePath;
}

export function hideFile(relativePath: string): void {
  const cfg = loadConfig();
  if (!cfg.hidden) { cfg.hidden = []; }
  if (!cfg.hidden.includes(relativePath)) {
    cfg.hidden.push(relativePath);
  }
  if (cfg.order) {
    cfg.order = cfg.order.filter(f => f !== relativePath);
  }
  saveConfig(cfg);
  cachedFiles = cachedFiles.filter(f => f !== relativePath);
  if (!cachedHidden.includes(relativePath)) {
    cachedHidden = [...cachedHidden, relativePath];
  }
}

export function unhideFile(relativePath: string): void {
  const cfg = loadConfig();
  cfg.hidden = (cfg.hidden ?? []).filter(f => f !== relativePath);
  saveConfig(cfg);
  cachedHidden = cachedHidden.filter(f => f !== relativePath);
  if (!cachedFiles.includes(relativePath)) {
    cachedFiles = [...cachedFiles, relativePath];
  }
}

export function reorderFiles(newOrder: string[]): void {
  cachedFiles = newOrder;
  const cfg = loadConfig();
  cfg.order = newOrder;
  saveConfig(cfg);
}

export function getCachedFiles(): string[] {
  return cachedFiles;
}

export function getHiddenFiles(): string[] {
  return cachedHidden;
}

export function getActiveFile(): string | undefined {
  return activeFile;
}
