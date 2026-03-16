import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { autoSelectBoard, getActiveBoard, getActiveBoardFile, getEffectivePort, getLayout, getPortOverride, getDefaultTargetFile, listBoards, PanelLayout, selectBoardByFile, setDefaultBoardFile, setDefaultTargetFile, setLayout, setPortOverride } from "./boardConfig";

const DEFAULT_ACTIONS: Record<string, { label: string; color: string }> = {
    build: { label: "Build", color: "#1e7ec8" },
    flash: { label: "Flash", color: "#d1a618" },
    rtt:   { label: "RTT Monitor", color: "#4caf50" },
};
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";
import { fetchLibraryList, fetchAndSaveBoard, isBoardCached, isBoardInWorkspace, copyBoardToWorkspace, removeBoard, fetchBoardContent, getWorkspaceBoardContent, updateBoardInWorkspace } from "./boardLibrary";

function loadHtml(ext: vscode.ExtensionContext, webview: vscode.Webview, htmlFile: string, jsFile: string): string {
    const mediaPath = vscode.Uri.joinPath(ext.extensionUri, "media");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, "panel.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, jsFile));
    const htmlPath = path.join(ext.extensionUri.fsPath, "media", htmlFile);
    return fs.readFileSync(htmlPath, "utf8")
        .replace("{{CSS_URI}}", cssUri.toString())
        .replace("{{JS_URI}}", jsUri.toString());
}

export class BoardPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rdyno.panel";

    private view?: vscode.WebviewView;
    private _pollInterval: NodeJS.Timeout | undefined;

    constructor(private readonly ext: vscode.ExtensionContext) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.ext.extensionUri, "media"),
                vscode.Uri.joinPath(this.ext.extensionUri, "imgs"),
            ],
        };

        const savedPort = this.ext.workspaceState.get<string>("portOverride");
        if (savedPort) { setPortOverride(savedPort); }

        if (!getActiveBoard()) { autoSelectBoard(); }
        const savedTarget = getDefaultTargetFile();
        if (savedTarget) { openFile(savedTarget); }
        view.webview.html = this.getHtml();
        this.sendState();

        refreshFiles().then(() => { this.sendState(); });

        this.startPolling(view);
        view.onDidDispose(() => {
            if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = undefined; }
        });

        view.webview.onDidReceiveMessage((msg) => {
            switch (msg.command) {
                case "selectBoard":
                    selectBoardByFile(msg.data);
                    setDefaultBoardFile(msg.data);
                    this.sendState();
                    break;
                case "selectFile": {
                    openFile(msg.data);
                    this.sendState();
                    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (wsRoot) {
                        const uri = vscode.Uri.file(path.join(wsRoot, msg.data));
                        vscode.window.showTextDocument(uri, { preview: false });
                    }
                    break;
                }
                case "hideFile":
                    hideFile(msg.data);
                    this.sendState();
                    break;
                case "unhideFile":
                    unhideFile(msg.data);
                    this.sendState();
                    break;
                case "reorderFiles":
                    reorderFiles(msg.data);
                    break;
                case "saveLayout":
                    setLayout(msg.data as PanelLayout);
                    break;
                case "setTarget":
                    openFile(msg.data);
                    setDefaultTargetFile(msg.data);
                    this.sendState();
                    break;
                case "setPort":
                    setPortOverride(msg.data || undefined);
                    this.ext.workspaceState.update("portOverride", msg.data || undefined);
                    break;
                case "listPorts": {
                    const probePath = vscode.workspace.getConfiguration("rdyno").get<string>("probersPath", "probe-rs");
                    exec(`${probePath} list`, (_err, stdout) => {
                        const ports: { id: string; label: string }[] = [];
                        for (const line of stdout.split("\n")) {
                            const m = line.match(/\[\d+\]:\s*(.+?)\s*--\s*([0-9a-fA-F]{4}:[0-9a-fA-F]{4}:\S+)/);
                            if (m) { ports.push({ id: m[2], label: `${m[1]} (${m[2]})` }); }
                        }
                        view.webview.postMessage({ command: "ports", data: ports });
                    });
                    break;
                }
                case "refresh":
                    refreshFiles().then(() => { this.sendState(); });
                    break;
                case "build": vscode.commands.executeCommand("rdyno.build"); break;
                case "flash": vscode.commands.executeCommand("rdyno.flash"); break;
                case "rtt": vscode.commands.executeCommand("rdyno.rtt"); break;
                case "selectAndRun": {
                    openFile(msg.data.file);
                    this.sendState();
                    vscode.commands.executeCommand(`rdyno.${msg.data.cmd}`);
                    break;
                }
            }
        });
    }

    refresh() {
        this.sendState();
    }

    private sendState() {
        if (!this.view) { return; }
        const webview = this.view.webview;
        const uri = (rel: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, rel)).toString();
        webview.postMessage({
            command: "init",
            data: {
                files: getCachedFiles(),
                hiddenFiles: getHiddenFiles(),
                pickedFile: getActiveFile(),
                boards: listBoards(),
                activeBoardFile: getActiveBoardFile(),
                activeName: getActiveBoard()?.board.name ?? "None",
                effectivePort: getEffectivePort() ?? "",
                portIsFromConfig: !getPortOverride() && !!getActiveBoard()?.probe?.port,
                portOverride: getPortOverride() ?? "",
                cmdPreviews: {
                    build: this.getCmdPreview("build"),
                    flash: this.getCmdPreview("flash"),
                    rtt: this.getCmdPreview("rtt"),
                },
                actions: this.getResolvedActions(),
                uris: {
                    run: uri("imgs/run.svg"),
                    refresh: uri("imgs/refresh.svg"),
                    check: uri("imgs/check.svg"),
                    drop: uri("imgs/drop.svg"),
                    eye: uri("imgs/eye.svg"),
                    eyeSlash: uri("imgs/eye-slash.svg"),
                },
                layout: getLayout() ?? null,
            },
        });
    }

    private startPolling(view: vscode.WebviewView) {
        const probePath = vscode.workspace.getConfiguration("rdyno").get<string>("probersPath", "probe-rs");
        const poll = () => {
            exec(`${probePath} list`, (_err, stdout) => {
                const probes: { id: string; label: string }[] = [];
                for (const line of stdout.split("\n")) {
                    const m = line.match(/\[\d+\]:\s*(.+?)\s*--\s*([0-9a-fA-F]{4}:[0-9a-fA-F]{4}:\S+)/);
                    if (m) { probes.push({ id: m[2], label: m[1].trim() }); }
                }
                const port = getEffectivePort();
                const connected = port ? probes.some(p => p.id === port) : probes.length > 0;
                view.webview.postMessage({ command: "probeStatus", data: { connected, probes } });
            });
        };
        poll();
        this._pollInterval = setInterval(poll, 5000);
    }

    private getResolvedActions(): Record<string, { label: string; color: string }> {
        const boardActions = getActiveBoard()?.actions ?? {};
        const resolved: Record<string, { label: string; color: string }> = {};
        for (const [id, def] of Object.entries(DEFAULT_ACTIONS)) {
            const override = boardActions[id] ?? {};
            resolved[id] = { label: override.label ?? def.label, color: override.color ?? def.color };
        }
        return resolved;
    }

    private getCmdPreview(cmd: string): string {
        const board = getActiveBoard();
        const probePath = vscode.workspace.getConfiguration("rdyno").get<string>("probersPath", "probe-rs");
        const port = getEffectivePort();
        const portFlag = port ? ` --probe ${port}` : "";
        switch (cmd) {
            case "build":
                if (!board) { return "cargo build --release"; }
                return `cargo build --release --target ${board.board.target}`;
            case "flash":
                if (!board) { return `${probePath} run ...`; }
                if (board.run?.command) { return board.run.command; }
                if (!board.probe) { return "(no flash command configured)"; }
                return `${probePath} run --chip ${board.board.chip} --protocol ${board.probe.protocol} --speed ${board.probe.speed}${portFlag} target/${board.board.target}/release/<crate>`;
            case "rtt":
                if (!board) { return `${probePath} attach ...`; }
                if (!board.probe) { return "(RTT requires [probe] section)"; }
                return `${probePath} attach --chip ${board.board.chip} --protocol ${board.probe.protocol}${portFlag}`;
            default:
                return cmd;
        }
    }

    private getHtml(): string {
        return loadHtml(this.ext, this.view!.webview, "panel.html", "panel.js");
    }
}

export class NewProjectPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rdyno.newProject";

    private view?: vscode.WebviewView;

    constructor(private readonly ext: vscode.ExtensionContext) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.ext.extensionUri, "media"),
                vscode.Uri.joinPath(this.ext.extensionUri, "imgs"),
            ],
        };
        view.webview.html = this.getHtml();
        this.sendState();
        view.webview.onDidReceiveMessage((msg) => {
            if (msg.command === "newProject") {
                vscode.commands.executeCommand("rdyno.newProject");
            } else if (msg.command === "refreshBoards") {
                this.sendState();
            } else if (msg.command === "selectBoard") {
                selectBoardByFile(msg.data);
                setDefaultBoardFile(msg.data);
                this.sendState();
            }
        });
    }

    refresh() {
        this.sendState();
    }

    private sendState() {
        if (!this.view) { return; }
        const webview = this.view.webview;
        const uri = (rel: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, rel)).toString();
        const board = getActiveBoard();
        webview.postMessage({
            command: "init",
            data: {
                hasConfig: !!board?.new_project,
                boardName: board?.board.name ?? "no board selected",
                boards: listBoards(),
                activeBoardFile: getActiveBoardFile(),
                uris: { drop: uri("imgs/drop.svg"), refresh: uri("imgs/refresh.svg") },
            },
        });
    }

    private getHtml(): string {
        return loadHtml(this.ext, this.view!.webview, "new-project.html", "new-project.js");
    }
}

export class BoardLibraryPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rdyno.boardLibrary";

    private view?: vscode.WebviewView;

    constructor(private readonly ext: vscode.ExtensionContext) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.ext.extensionUri, "media"),
                vscode.Uri.joinPath(this.ext.extensionUri, "imgs"),
            ],
        };
        view.webview.html = this.getHtml();
        this.sendSetup();

        view.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case "fetchLibrary": {
                    const repo = vscode.workspace.getConfiguration("rdyno").get<string>("boardLibraryRepo", "");
                    if (!repo) {
                        view.webview.postMessage({ command: "libraryError", data: "No repo configured. Set rdyno.boardLibraryRepo in settings." });
                        return;
                    }
                    try {
                        const entries = await fetchLibraryList(repo);
                        const withStatus = await Promise.all(entries.map(async e => {
                            const inWorkspace = isBoardInWorkspace(e.name);
                            let hasUpdate = false;
                            if (inWorkspace) {
                                try {
                                    const localContent = getWorkspaceBoardContent(e.name);
                                    const remoteContent = await fetchBoardContent(e.downloadUrl);
                                    hasUpdate = localContent !== undefined && localContent.trim() !== remoteContent.trim();
                                } catch { /* ignore update check failure */ }
                            }
                            return { ...e, cached: isBoardCached(e.name), inWorkspace, hasUpdate };
                        }));
                        view.webview.postMessage({ command: "libraryList", data: withStatus });
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error("[rdyno] fetchLibrary error:", errMsg);
                        view.webview.postMessage({ command: "libraryError", data: `Failed to fetch library: ${errMsg}` });
                    }
                    break;
                }
                case "downloadBoard": {
                    const { name, downloadUrl } = msg.data as { name: string; downloadUrl: string };
                    try {
                        await fetchAndSaveBoard(name, downloadUrl);
                        view.webview.postMessage({ command: "boardDownloaded", data: name });
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "boardError", data: { name, error: errMsg } });
                        vscode.window.showErrorMessage(`Failed to download board: ${errMsg}`);
                    }
                    break;
                }
                case "addToProject": {
                    const name = msg.data as string;
                    try {
                        copyBoardToWorkspace(name);
                        view.webview.postMessage({ command: "boardAddedToProject", data: name });
                        vscode.window.showInformationMessage(`Board added to project: ${name}`);
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "boardError", data: { name, error: errMsg } });
                        vscode.window.showErrorMessage(`Failed to add board to project: ${errMsg}`);
                    }
                    break;
                }
                case "updateBoard": {
                    const { name, downloadUrl } = msg.data as { name: string; downloadUrl: string };
                    try {
                        await updateBoardInWorkspace(name, downloadUrl);
                        view.webview.postMessage({ command: "boardUpdated", data: name });
                        vscode.window.showInformationMessage(`Board updated: ${name}`);
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "boardError", data: { name, error: errMsg } });
                        vscode.window.showErrorMessage(`Failed to update board: ${errMsg}`);
                    }
                    break;
                }
                case "removeBoard": {
                    const name = msg.data as string;
                    removeBoard(name);
                    view.webview.postMessage({ command: "boardRemoved", data: name });
                    break;
                }
                case "openSettings": {
                    vscode.commands.executeCommand("workbench.action.openSettings", "rdyno.boardLibraryRepo");
                    break;
                }
            }
        });
    }

    private sendSetup() {
        if (!this.view) { return; }
        const webview = this.view.webview;
        const uri = (rel: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, rel)).toString();
        webview.postMessage({
            command: "setup",
            uris: {
                check: uri("imgs/check.svg"),
                down: uri("imgs/down.svg"),
                plus: uri("imgs/plus.svg"),
                refresh: uri("imgs/refresh.svg"),
            },
        });
    }

    private getHtml(): string {
        return loadHtml(this.ext, this.view!.webview, "library.html", "library.js");
    }
}
