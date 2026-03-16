import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { autoSelectBoard, getActiveBoard, getActiveBoardFile, getEffectivePort, getPortOverride, listBoards, selectBoardByFile, setDefaultBoardFile, setPortOverride } from "./boardConfig";
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";
import { fetchLibraryList, fetchAndSaveBoard, isBoardInstalled, removeBoard } from "./boardLibrary";

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
            const inner = `<span class="btn-icon"><img src="${runUri}" class="btn-run-icon"></span>
          <span class="btn-label">${label}</span>
          <span class="btn-check"><img src="${checkUri}" class="btn-check-icon"></span>`;
            if (files.length > 1) {
                const dropItems = files.map(f =>
                    `<div class="drop-item${f === pickedFile ? " drop-active" : ""}" onclick="pickTarget(${esc(JSON.stringify(f))},'${cmd}')">${esc(path.basename(f))}</div>`
                ).join("");
                return `<div class="split-group" id="grp-${cmd}">
          <button class="split-main action-button" onclick="sendAction(this,'${cmd}')" data-tip-label="${label}" data-tip-cmd="${esc(this.getCmdPreview(cmd))}">${inner}</button>
          <button class="split-drop" onclick="toggleDrop(event,'menu-${cmd}')"><img src="${dropUri}" class="drop-icon"></button>
          <div class="drop-menu" id="menu-${cmd}">${dropItems}</div>
        </div>`;
            }
            return `<button onclick="sendAction(this,'${cmd}')" class="action-button" data-tip-label="${label}" data-tip-cmd="${esc(this.getCmdPreview(cmd))}">${inner}</button>`;
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
      <div class="cs-wrap">
        <div class="cs-btn" onclick="toggleDrop(event,'menu-target')">
          <span class="cs-val">${pickedFile ? esc(path.basename(pickedFile)) : "No files"}</span>
          <img src="${dropUri}" class="drop-icon">
        </div>
        <div class="drop-menu" id="menu-target">
          ${files.length
                ? files.map(f => `<div class="drop-item${f === pickedFile ? " drop-active" : ""}" onclick="send('selectFile',${esc(JSON.stringify(f))})">${esc(path.basename(f))}</div>`).join("")
                : `<div class="drop-item" style="opacity:0.5;cursor:default">No files</div>`}
        </div>
      </div>

      <div class="config-header" onclick="toggleConfig()">
        <img src="${dropUri}" class="config-arrow" id="configArrow">
        <span class="config-summary" id="configSummary">${configSummary}</span>
        <span id="probeDot" class="probe-dot" title="Checking..."></span>
      </div>
      <div id="configSection" style="display:none">
        <div class="label" style="margin-top:6px">Board</div>
        <div class="cs-wrap">
          <div class="cs-btn" onclick="toggleDrop(event,'menu-board')">
            <span class="cs-val">${activeBoardFile ? esc(activeBoardFile.replace(/\.toml$/, "")) : "-- choose a board --"}</span>
            <img src="${dropUri}" class="drop-icon">
          </div>
          <div class="drop-menu" id="menu-board">
            ${boards.length
                ? boards.map(f => `<div class="drop-item${f === activeBoardFile ? " drop-active" : ""}" onclick="send('selectBoard',${esc(JSON.stringify(f))})">${esc(f.replace(/\.toml$/, ""))}</div>`).join("")
                : `<div class="drop-item" style="opacity:0.5;cursor:default">No boards</div>`}
          </div>
        </div>
        <div class="active-board">Active: ${activeName}</div>
        <div class="label">Port${portIsFromConfig ? ` <span style="opacity:0.6;font-style:italic">(from config: ${esc(effectivePort)})</span>` : ""}</div>
        <div style="display:flex;gap:4px;margin-bottom:8px">
          <div class="cs-wrap" style="flex:1;margin:0">
            <div class="cs-btn" onclick="toggleDrop(event,'menu-port')">
              <span class="cs-val" id="cs-val-port">${effectivePort || "auto"}</span>
              <img src="${dropUri}" class="drop-icon">
            </div>
            <div class="drop-menu" id="menu-port">
              <div class="drop-item${!getPortOverride() ? " drop-active" : ""}" data-val="" onclick="pickPort('','auto')">-- auto --</div>
            </div>
          </div>
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
                        const withInstalled = entries.map(e => ({ ...e, installed: isBoardInstalled(e.name) }));
                        view.webview.postMessage({ command: "libraryList", data: withInstalled });
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error("[rdyno] fetchLibrary error:", errMsg);
                        view.webview.postMessage({ command: "libraryError", data: `Failed to fetch library: ${errMsg}` });
                    }
                    break;
                }
                case "addBoard": {
                    const { name, downloadUrl } = msg.data as { name: string; downloadUrl: string };
                    try {
                        await fetchAndSaveBoard(name, downloadUrl);
                        view.webview.postMessage({ command: "boardAdded", data: name });
                        vscode.window.showInformationMessage(`Board saved: ${name}`);
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "boardError", data: { name, error: errMsg } });
                        vscode.window.showErrorMessage(`Failed to add board: ${errMsg}`);
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

    private getHtml(): string {
        const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
        const checkUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "imgs", "check.svg"));
        return /*html*/`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="${cssUri}">
  <style>
    .lib-item { display:flex; align-items:center; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--vscode-dropdown-border); }
    .lib-item:last-child { border-bottom:none; }
    .lib-name { font-size:12px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .lib-add { width:auto; padding:2px 8px; margin:0; font-size:11px; min-height:unset; flex-shrink:0; }
    .lib-added { width:auto; padding:2px 4px; margin:0; min-height:unset; flex-shrink:0; opacity:0.5; cursor:default; background:transparent; border:1px solid var(--vscode-dropdown-border); display:inline-flex; align-items:center; }
    .lib-added img { width:14px; height:14px; display:block; }
    .lib-list { border:1px solid var(--vscode-dropdown-border); border-radius:4px; margin-bottom:8px; max-height:300px; overflow-y:auto; }
    .lib-status { font-size:12px; opacity:0.6; font-style:italic; padding:8px; }
    .lib-error { font-size:12px; color:var(--vscode-errorForeground); padding:8px; }
    .lib-configure { font-size:12px; opacity:0.7; margin-bottom:8px; }
  </style>
</head>
<body>
  <div class="section-row">
    <span class="label">Board Library</span>
    <button class="icon-btn" onclick="load()" title="Refresh">↺</button>
  </div>
  <div id="content"><div class="lib-status">Loading…</div></div>
  <script>
    const vscode = acquireVsCodeApi();
    const CHECK_URI = ${JSON.stringify(checkUri.toString())};
    let boardIndex = {};
    function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }
    function checkBtn(name) { return \`<button class="lib-added" data-board="\${esc(name)}" ondblclick="removeBoard(this)" title="Double-click to remove"><img src="\${CHECK_URI}"></button>\`; }
    function removeBoard(btn) { const name = btn.dataset.board; btn.disabled = true; send('removeBoard', name); }

    function load() {
      document.getElementById('content').innerHTML = '<div class="lib-status">Loading…</div>';
      send('fetchLibrary');
    }

    function addBoard(btn) {
      const name = btn.dataset.board;
      const downloadUrl = btn.dataset.url;
      btn.disabled = true; btn.textContent = '…';
      send('addBoard', { name, downloadUrl });
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.command === 'libraryList') {
        if (!msg.data.length) {
          document.getElementById('content').innerHTML = '<div class="lib-status">No .toml files found in repo.</div>';
          return;
        }
        boardIndex = Object.fromEntries(msg.data.map(b => [b.name, b.downloadUrl]));
        const rows = msg.data.map(b => {
          const btn = b.installed
            ? checkBtn(b.name)
            : \`<button class="lib-add" data-board="\${esc(b.name)}" data-url="\${esc(b.downloadUrl)}" onclick="addBoard(this)">+</button>\`;
          return \`<div class="lib-item"><span class="lib-name" title="\${esc(b.path)}">\${esc(b.path.replace(/\\.toml$/, ''))}</span>\${btn}</div>\`;
        }).join('');
        document.getElementById('content').innerHTML = \`<div class="lib-list">\${rows}</div>\`;
      } else if (msg.command === 'libraryError') {
        const isConfig = msg.data.includes('No repo configured');
        document.getElementById('content').innerHTML = \`
          <div class="lib-error">\${esc(msg.data)}</div>
          \${isConfig ? '<button class="icon-btn" style="width:auto;padding:4px 10px;font-size:12px" onclick="send(\\'openSettings\\')">Open Settings</button>' : ''}\`;
      } else if (msg.command === 'boardAdded') {
        const btn = document.querySelector('[data-board="' + CSS.escape(msg.data) + '"]');
        if (btn) { btn.outerHTML = checkBtn(msg.data); }
      } else if (msg.command === 'boardRemoved') {
        const btn = document.querySelector('[data-board="' + CSS.escape(msg.data) + '"]');
        if (btn) { btn.outerHTML = \`<button class="lib-add" data-board="\${esc(msg.data)}" data-url="\${esc(boardIndex[msg.data] || '')}" onclick="addBoard(this)">+</button>\`; }
      } else if (msg.command === 'boardError') {
        const btn = document.querySelector('[data-board="' + CSS.escape(msg.data.name) + '"]');
        if (btn) { btn.disabled = false; btn.textContent = '+'; }
      }
    });

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    load();
  </script>
</body>
</html>`;
    }
}
