import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { autoSelectBoard, getActiveBoard, getActiveBoardFile, getEffectivePort, getPortOverride, listBoards, selectBoardByFile, setDefaultBoardFile, setPortOverride } from "./boardConfig";
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";

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

        refreshFiles().then(() => { view.webview.html = this.getHtml(); });

        this.startPolling(view);
        view.onDidDispose(() => {
            if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = undefined; }
        });

        view.webview.onDidReceiveMessage((msg) => {
            switch (msg.command) {
                case "selectBoard":
                    selectBoardByFile(msg.data);
                    setDefaultBoardFile(msg.data);
                    view.webview.html = this.getHtml();
                    break;
                case "selectFile": {
                    openFile(msg.data);
                    view.webview.html = this.getHtml();
                    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (wsRoot) {
                        const uri = vscode.Uri.file(path.join(wsRoot, msg.data));
                        vscode.window.showTextDocument(uri, { preview: false });
                    }
                    break;
                }
                case "hideFile":
                    hideFile(msg.data);
                    view.webview.html = this.getHtml();
                    break;
                case "unhideFile":
                    unhideFile(msg.data);
                    view.webview.html = this.getHtml();
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
                    refreshFiles().then(() => { view.webview.html = this.getHtml(); });
                    break;
                case "build": vscode.commands.executeCommand("embeddedRust.build"); break;
                case "flash": vscode.commands.executeCommand("embeddedRust.flash"); break;
                case "rtt": vscode.commands.executeCommand("embeddedRust.rtt"); break;
                case "selectAndRun": {
                    openFile(msg.data.file);
                    view.webview.html = this.getHtml();
                    vscode.commands.executeCommand(`embeddedRust.${msg.data.cmd}`);
                    break;
                }
            }
        });
    }

    refresh() {
        if (this.view) {
            this.view.webview.html = this.getHtml();
        }
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
        const activeName = getActiveBoard()?.board.name ?? "None";
        const activeBoardFile = getActiveBoardFile();
        const effectivePort = getEffectivePort() ?? "";
        const portIsFromConfig = !getPortOverride() && !!getActiveBoard()?.probe?.port;
        const pickedFile = getActiveFile();
        const boards = listBoards();
        const files = getCachedFiles();
        const hidden = getHiddenFiles();
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const jsUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.js"));
        const runUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "run.svg"));
        const refreshUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "refresh.svg"));
        const checkUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "check.svg"));
        const dynoUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "dyno.svg"));
        const dropUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "drop.svg"));

        const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

        const options = boards
            .map((f) => `<option value="${f}"${f === activeBoardFile ? " selected" : ""}>${f.replace(/\.toml$/, "")}</option>`)
            .join("\n        ");

        const fileItems = files.length
            ? files.map((f, i) => {
                const isActive = f === pickedFile;
                return `<div class="file-item${isActive ? " active" : ""}" draggable="true" data-file="${esc(f)}" data-index="${i}" ondragstart="onDragStart(event,${i})" ondragend="onDragEnd(event)" ondragover="onDragOver(event,${i})" ondrop="onDrop(event,${i})" onclick="onItemClick(event,${esc(JSON.stringify(f))})" title="${esc(f)}">
            <span class="file-name">${esc(path.basename(f))}</span>
            <button class="remove-btn" draggable="false" onclick="event.stopPropagation();send('hideFile',${esc(JSON.stringify(f))})" title="Hide file">✕</button>
          </div>`;
            }).join("\n")
            : `<div class="file-empty">No files found</div>`;

        const hiddenItems = hidden.length
            ? hidden.map((f) => {
                return `<div class="file-item hidden-item" title="${esc(f)}">
            <span class="file-name">${esc(path.basename(f))}</span>
            <button class="remove-btn" onclick="event.stopPropagation();send('unhideFile',${esc(JSON.stringify(f))})" title="Restore file">✕</button>
          </div>`;
            }).join("\n")
            : `<div class="file-empty">No hidden files</div>`;

        const portSummary = effectivePort ? esc(effectivePort) : "auto";
        const configSummary = `${activeName} · ${portSummary}`;

        return /*html*/ `<!DOCTYPE html>
    <html>
    <head>
      <link rel="stylesheet" href="${cssUri}">
    </head>
    <body>
      <!-- <img src="${dynoUri}" class="dyno-logo"> -->
      
      <div class="section-row">
        <span class="label">Files</span>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" id="hiddenToggle" onclick="toggleHidden()" title="Toggle hidden files" style="opacity:${hidden.length > 0 ? "1" : "0.5"}">◌${hidden.length > 0 ? ` ${hidden.length}` : ""}</button>
          <button class="icon-btn" onclick="send('refresh')" title="Refresh file list"><img src="${refreshUri}" class="icon-svg"></button>
        </div>
      </div>
      <div class="file-list" id="fileList">
        ${fileItems}
      </div>
      <div id="hiddenSection" style="display:none">
        <div class="label" style="margin-top:4px">Hidden</div>
        <div class="file-list">
          ${hiddenItems}
        </div>
      </div>
      
      ${["build", "flash"].map(cmd => {
            const label = cmd[0].toUpperCase() + cmd.slice(1);
            return `<button onclick="sendAction(this,'${cmd}')" class="action-button" data-tip-label="${label}" data-tip-cmd="${esc(this.getCmdPreview(cmd))}">
          <span class="btn-icon"><img src="${runUri}" class="btn-run-icon"></span>
          <span class="btn-label">${label}</span>
          <span class="btn-check"><img src="${checkUri}" class="btn-check-icon"></span>
        </button>`;
        }).join("\n      ")}
      <button onclick="sendAction(this,'rtt')" class="action-button" data-tip-label="RTT Monitor" data-tip-cmd="${esc(this.getCmdPreview("rtt"))}">
        <span class="btn-icon">
            <img src="${runUri}" class="btn-run-icon">
        </span>
        <span class="btn-label">RTT Monitor</span>
        <span class="btn-check">
            <img src="${checkUri}" class="btn-check-icon">
        </span>
      </button>
      
      
      <div class="label">Target</div>
      <select onchange="send('selectFile',this.value)" style="margin-bottom:8px">
        ${files.length
                ? files.map(f => `<option value="${esc(f)}"${f === pickedFile ? " selected" : ""}>${esc(path.basename(f))}</option>`).join("")
                : `<option value="" disabled>No files</option>`}
      </select>

      <div class="config-header" onclick="toggleConfig()">
        <img src="${dropUri}" class="config-arrow" id="configArrow">
        <span class="config-summary" id="configSummary">${configSummary}</span>
        <span id="probeDot" class="probe-dot" title="Checking..."></span>
      </div>
      <div id="configSection" style="display:none">
        <div class="label" style="margin-top:6px">Board</div>
        <select onchange="send('selectBoard',this.value)">
          <option value="" disabled${activeBoardFile ? "" : " selected"}>-- choose a board --</option>
          ${options}
        </select>
        <div class="active-board">Active: ${activeName}</div>
        <div class="label">Port${portIsFromConfig ? ` <span style="opacity:0.6;font-style:italic">(from config: ${esc(effectivePort)})</span>` : ""}</div>
        <div style="display:flex;gap:4px;margin-bottom:8px">
          <select id="portSelect" onchange="onPortChange(this.value)" style="flex:1;margin:0;width:0;min-width:0">
            <option value="">-- auto --</option>
          </select>
          <button class="icon-btn" onclick="refreshPorts()" title="Refresh port list" style="flex-shrink:0"><img src="${refreshUri}" class="icon-svg"></button>
        </div>
      </div>
      
      <script>window.HIDDEN_COUNT = ${hidden.length}; window.CURRENT_PORT = ${JSON.stringify(getPortOverride() ?? "")};</script>
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
        view.webview.onDidReceiveMessage((msg) => {
            if (msg.command === "newProject") {
                vscode.commands.executeCommand("embeddedRust.newProject");
            }
        });
    }

    refresh() {
        if (this.view) { this.view.webview.html = this.getHtml(); }
    }

    private getHtml(): string {
        const board = getActiveBoard();
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

        const hasConfig = !!board?.new_project;
        const boardName = board?.board.name ?? "no board selected";

        const body = hasConfig
            ? `<p class="np-board">Board: <strong>${esc(boardName)}</strong></p>
      <button onclick="send('newProject')">New Project…</button>`
            : `<p class="np-hint">Select a board with a <code>[new_project]</code> config to scaffold a project.</p>`;

        return /*html*/`<!DOCTYPE html>
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
      ${body}
      <script>
        const vscode = acquireVsCodeApi();
        function send(cmd) { vscode.postMessage({ command: cmd }); }
      </script>
    </body>
    </html>`;
    }
}
