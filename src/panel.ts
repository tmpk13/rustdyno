import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { autoSelectBoard, getActiveBoard, getActiveBoardFile, getEffectivePort, getPortOverride, listBoards, selectBoardByFile, setDefaultBoardFile, setPortOverride } from "./boardConfig";
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";
import { fetchLibraryList, fetchAndSaveBoard, isBoardCached, isBoardInWorkspace, copyBoardToWorkspace, removeBoard } from "./boardLibrary";

export class BoardPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "embeddedRust.panel";

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
                case "setPort":
                    setPortOverride(msg.data || undefined);
                    this.ext.workspaceState.update("portOverride", msg.data || undefined);
                    break;
                case "listPorts": {
                    const probePath = vscode.workspace.getConfiguration("embeddedRust").get<string>("probersPath", "probe-rs");
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
                case "build": vscode.commands.executeCommand("embeddedRust.build"); break;
                case "flash": vscode.commands.executeCommand("embeddedRust.flash"); break;
                case "rtt": vscode.commands.executeCommand("embeddedRust.rtt"); break;
                case "selectAndRun": {
                    openFile(msg.data.file);
                    this.sendState();
                    vscode.commands.executeCommand(`embeddedRust.${msg.data.cmd}`);
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
                uris: {
                    run: uri("imgs/run.svg"),
                    refresh: uri("imgs/refresh.svg"),
                    check: uri("imgs/check.svg"),
                    drop: uri("imgs/drop.svg"),
                },
            },
        });
    }

    private startPolling(view: vscode.WebviewView) {
        const probePath = vscode.workspace.getConfiguration("embeddedRust").get<string>("probersPath", "probe-rs");
        const poll = () => {
            exec(`${probePath} list`, (_err, stdout) => {
                const probeIds: string[] = [];
                for (const line of stdout.split("\n")) {
                    const m = line.match(/\[\d+\]:\s*.+?\s*--\s*([0-9a-fA-F]{4}:[0-9a-fA-F]{4}:\S+)/);
                    if (m) { probeIds.push(m[1]); }
                }
                const port = getEffectivePort();
                const connected = port ? probeIds.includes(port) : probeIds.length > 0;
                view.webview.postMessage({ command: "probeStatus", data: { connected, probeIds } });
            });
        };
        poll();
        this._pollInterval = setInterval(poll, 5000);
    }

    private getCmdPreview(cmd: string): string {
        const board = getActiveBoard();
        const probePath = vscode.workspace.getConfiguration("embeddedRust").get<string>("probersPath", "probe-rs");
        const port = getEffectivePort();
        const portFlag = port ? ` --probe ${port}` : "";
        switch (cmd) {
            case "build":
                if (!board) { return "cargo build --release"; }
                return `cargo build --release --target ${board.board.target}`;
            case "flash":
                if (!board) { return `${probePath} run ...`; }
                if (board.run?.command) { return board.run.command; }
                return `${probePath} run --chip ${board.board.chip} --protocol ${board.probe.protocol} --speed ${board.probe.speed}${portFlag} target/${board.board.target}/release/<crate>`;
            case "rtt":
                if (!board) { return `${probePath} attach ...`; }
                return `${probePath} attach --chip ${board.board.chip} --protocol ${board.probe.protocol}${portFlag}`;
            default:
                return cmd;
        }
    }

    private getHtml(): string {
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const jsUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.js"));
        return `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="section-row">
    <span class="label">Files</span>
    <div style="display:flex;gap:4px">
      <button class="icon-btn" id="hiddenToggle" onclick="toggleHidden()" title="Toggle hidden files" style="opacity:0.5">&#9676;</button>
      <button class="icon-btn" onclick="send('refresh')" title="Refresh file list"><img id="refreshIcon" class="icon-svg"></button>
    </div>
  </div>
  <div class="file-list" id="fileList"></div>
  <div id="hiddenSection" style="display:none">
    <div class="label" style="margin-top:4px">Hidden</div>
    <div class="file-list" id="hiddenList"></div>
  </div>
  <div id="actionBtns"></div>
  <button id="rttBtn" onclick="sendAction(this,'rtt')" class="action-button" data-tip-label="RTT Monitor" data-tip-cmd="">
    <span class="btn-icon"><img id="rttRunIcon" class="btn-run-icon"></span>
    <span class="btn-label">RTT Monitor</span>
    <span class="btn-check"><img id="rttCheckIcon" class="btn-check-icon"></span>
  </button>
  <div class="label">Target</div>
  <div class="cs-wrap">
    <div class="cs-btn" onclick="toggleDrop(event,'menu-target')">
      <span class="cs-val" id="cs-val-target">No files</span>
      <img id="dropTarget" class="drop-icon">
    </div>
    <div class="drop-menu" id="menu-target"></div>
  </div>
  <div class="config-header" onclick="toggleConfig()">
    <img class="config-arrow" id="configArrow">
    <span class="config-summary" id="configSummary"></span>
    <span id="probeDot" class="probe-dot" title="Checking..."></span>
  </div>
  <div id="configSection" style="display:none">
    <div class="label" style="margin-top:6px">Board</div>
    <div class="cs-wrap">
      <div class="cs-btn" onclick="toggleDrop(event,'menu-board')">
        <span class="cs-val" id="cs-val-board">-- choose a board --</span>
        <img id="dropBoard" class="drop-icon">
      </div>
      <div class="drop-menu" id="menu-board"></div>
    </div>
    <div class="active-board" id="activeBoardLabel"></div>
    <div class="label" id="portLabelEl">Port</div>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      <div class="cs-wrap" style="flex:1;margin:0">
        <div class="cs-btn" onclick="toggleDrop(event,'menu-port')">
          <span class="cs-val" id="cs-val-port">auto</span>
          <img id="dropPort" class="drop-icon">
        </div>
        <div class="drop-menu" id="menu-port">
          <div class="drop-item drop-active" data-val="" onclick="pickPort('','auto')">-- auto --</div>
        </div>
      </div>
      <button class="icon-btn" onclick="refreshPorts()" title="Refresh port list" style="flex-shrink:0"><img id="refreshPortIcon" class="icon-svg"></button>
    </div>
  </div>
  <script src="${jsUri}"></script>
</body>
</html>`;
    }
}

export class NewProjectPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "embeddedRust.newProject";

    private view?: vscode.WebviewView;

    constructor(private readonly ext: vscode.ExtensionContext) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.ext.extensionUri, "media")],
        };
        view.webview.html = this.getHtml();
        this.sendState();
        view.webview.onDidReceiveMessage((msg) => {
            if (msg.command === "newProject") {
                vscode.commands.executeCommand("embeddedRust.newProject");
            }
        });
    }

    refresh() {
        this.sendState();
    }

    private sendState() {
        if (!this.view) { return; }
        const board = getActiveBoard();
        this.view.webview.postMessage({
            command: "init",
            data: {
                hasConfig: !!board?.new_project,
                boardName: board?.board.name ?? "no board selected",
            },
        });
    }

    private getHtml(): string {
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const jsUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "new-project.js"));
        return `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="${cssUri}">
  <style>
    .np-board { font-size:12px; opacity:0.75; margin:0 0 8px; }
    .np-hint  { font-size:12px; opacity:0.55; font-style:italic; margin:0; }
    code { font-family: var(--vscode-editor-font-family, monospace); }
  </style>
</head>
<body>
  <p class="np-hint" id="np-hint">Select a board with a <code>[new_project]</code> config to scaffold a project.</p>
  <div id="np-board" style="display:none">
    <p class="np-board">Board: <strong id="np-board-name"></strong></p>
    <button onclick="send('newProject')">New Project&#8230;</button>
  </div>
  <script src="${jsUri}"></script>
</body>
</html>`;
    }
}

export class BoardLibraryPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "embeddedRust.boardLibrary";

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
                    const repo = vscode.workspace.getConfiguration("embeddedRust").get<string>("boardLibraryRepo", "");
                    if (!repo) {
                        view.webview.postMessage({ command: "libraryError", data: "No repo configured. Set embeddedRust.boardLibraryRepo in settings." });
                        return;
                    }
                    try {
                        const entries = await fetchLibraryList(repo);
                        const withStatus = entries.map(e => ({
                            ...e,
                            cached: isBoardCached(e.name),
                            inWorkspace: isBoardInWorkspace(e.name),
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
                case "removeBoard": {
                    const name = msg.data as string;
                    removeBoard(name);
                    view.webview.postMessage({ command: "boardRemoved", data: name });
                    break;
                }
                case "openSettings": {
                    vscode.commands.executeCommand("workbench.action.openSettings", "embeddedRust.boardLibraryRepo");
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
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const jsUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "library.js"));
        return `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="section-row">
    <span class="label">Board Library</span>
    <button class="icon-btn" onclick="load()" title="Refresh">
      <img id="refreshIcon" class="icon-svg">
    </button>
  </div>
  <input id="search" type="text" placeholder="Search boards…" oninput="filterBoards(this.value)" autocomplete="off" spellcheck="false">
  <div id="content"><div class="lib-status">Loading…</div></div>
  <script src="${jsUri}"></script>
</body>
</html>`;
    }
}
