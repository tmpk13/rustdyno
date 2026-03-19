import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

let _globalBoardsDir: string | undefined;

export function initBoardLibrary(globalStoragePath: string): void {
    _globalBoardsDir = globalStoragePath;
    if (!fs.existsSync(globalStoragePath)) {
        fs.mkdirSync(globalStoragePath, { recursive: true });
    }
}

export function getGlobalBoardsDir(): string | undefined {
    return _globalBoardsDir;
}

export interface LibraryEntry {
    name: string;       // filename only, e.g. "stm32f4.toml"
    path: string;       // full repo path, e.g. "stm32/stm32f4.toml"
    downloadUrl: string;
}

function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "rustdyno-vscode/1.0" } }, (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                httpsGet(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", (chunk: string) => { data += chunk; });
            res.on("end", () => resolve(data));
        });
        req.on("error", reject);
    });
}

export async function fetchLibraryList(repo: string): Promise<LibraryEntry[]> {
    const repoInfo = JSON.parse(await httpsGet(`https://api.github.com/repos/${repo}`)) as { default_branch: string };
    const branch = repoInfo.default_branch;

    const treeData = JSON.parse(await httpsGet(
        `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=2`
    )) as { tree: Array<{ path: string; type: string }> };

    return treeData.tree
        .filter(i => i.type === "blob" && i.path.endsWith(".toml") && i.path.startsWith("boards/"))
        .map(i => ({
            name: i.path.split("/").pop()!,
            path: i.path,
            downloadUrl: `https://raw.githubusercontent.com/${repo}/${branch}/${i.path}`,
        }));
}

export function getBoardsInstallDir(): string {
    if (_globalBoardsDir) { return _globalBoardsDir; }
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const configDir = vscode.workspace.getConfiguration("rustdyno").get<string>("boardConfigDir", ".rustdyno");
    return path.join(wsRoot ?? ".", configDir);
}

export async function downloadBoardToWorkspace(filename: string, downloadUrl: string): Promise<void> {
    const content = await httpsGet(downloadUrl);
    const wsDir = getWorkspaceBoardDir();
    if (!wsDir) { throw new Error("No workspace open"); }
    if (!fs.existsSync(wsDir)) { fs.mkdirSync(wsDir, { recursive: true }); }
    fs.writeFileSync(path.join(wsDir, filename), content, "utf-8");
    // Update cache copy
    const cacheDir = getBoardsInstallDir();
    if (cacheDir !== wsDir) {
        if (!fs.existsSync(cacheDir)) { fs.mkdirSync(cacheDir, { recursive: true }); }
        fs.writeFileSync(path.join(cacheDir, filename), content, "utf-8");
    }
}

export function listCachedBoards(): string[] {
    const dir = getBoardsInstallDir();
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir).filter(f => f.endsWith(".toml"));
}

function copyCachedBoardToWorkspace(filename: string): void {
    const src = path.join(getBoardsInstallDir(), filename);
    if (!fs.existsSync(src)) { throw new Error(`Board not in cache: ${filename}`); }
    const dir = getWorkspaceBoardDir();
    if (!dir) { throw new Error("No workspace open"); }
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.copyFileSync(src, path.join(dir, filename));
}

export function addBoardFromCache(filename: string): void {
    copyCachedBoardToWorkspace(filename);
}

function getWorkspaceBoardDir(): string | undefined {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { return undefined; }
    const configDir = vscode.workspace.getConfiguration("rustdyno").get<string>("boardConfigDir", ".rustdyno");
    return path.join(wsRoot, configDir);
}

export function isBoardInWorkspace(filename: string): boolean {
    const dir = getWorkspaceBoardDir();
    return !!dir && fs.existsSync(path.join(dir, filename));
}

export function removeBoard(filename: string): void {
    const dir = getWorkspaceBoardDir();
    if (!dir) { return; }
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) { fs.unlinkSync(p); }
}

export async function fetchBoardContent(downloadUrl: string): Promise<string> {
    return httpsGet(downloadUrl);
}

export function getWorkspaceBoardContent(filename: string): string | undefined {
    const dir = getWorkspaceBoardDir();
    if (!dir) { return undefined; }
    const p = path.join(dir, filename);
    try { return fs.readFileSync(p, "utf-8"); } catch { return undefined; }
}

export async function updateBoardInWorkspace(filename: string, downloadUrl: string): Promise<void> {
    const content = await httpsGet(downloadUrl);
    const dir = getWorkspaceBoardDir();
    if (!dir) { throw new Error("No workspace open"); }
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}
