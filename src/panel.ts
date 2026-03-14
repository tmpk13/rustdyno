import * as vscode from "vscode";
import * as path from "path";
import { getActiveBoard, getActiveBoardFile, listBoards, selectBoardByFile } from "./boardConfig";
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";

export class BoardPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "embeddedRust.panel";

  private view?: vscode.WebviewView;

  constructor(private readonly ext: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ext.extensionUri, "media")],
    };
    view.webview.html = this.getHtml();

    refreshFiles().then(() => { view.webview.html = this.getHtml(); });

    view.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case "selectBoard":
          selectBoardByFile(msg.data);
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
        case "refresh":
          refreshFiles().then(() => { view.webview.html = this.getHtml(); });
          break;
        case "build": vscode.commands.executeCommand("embeddedRust.build"); break;
        case "flash": vscode.commands.executeCommand("embeddedRust.flash"); break;
        case "rtt":   vscode.commands.executeCommand("embeddedRust.rtt"); break;
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

  private getHtml(): string {
    const activeName = getActiveBoard()?.board.name ?? "None";
    const activeBoardFile = getActiveBoardFile();
    const pickedFile = getActiveFile();
    const boards = listBoards();
    const files = getCachedFiles();
    const hidden = getHiddenFiles();
    const cssUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.css"));
    const jsUri = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, "media", "panel.js"));

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

    return /*html*/ `<!DOCTYPE html>
    <html>
    <head>
      <link rel="stylesheet" href="${cssUri}">
    </head>
    <body>
      <div class="label">Board</div>
      <select onchange="send('selectBoard',this.value)">
        <option value="" disabled${activeBoardFile ? "" : " selected"}>-- choose a board --</option>
        ${options}
      </select>
      <div class="active-board">Active: ${activeName}</div>
      <div class="section-row">
        <span class="label">Files</span>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" id="hiddenToggle" onclick="toggleHidden()" title="Toggle hidden files" style="opacity:${hidden.length > 0 ? "1" : "0.5"}">◌${hidden.length > 0 ? ` ${hidden.length}` : ""}</button>
          <button class="icon-btn" onclick="send('refresh')" title="Refresh file list">↻</button>
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
      ${["build","flash"].map(cmd => {
        const label = cmd[0].toUpperCase() + cmd.slice(1);
        const items = files.length
          ? files.map(f => `<div class="drop-item${f === pickedFile ? " drop-active" : ""}" onclick="pickTarget(${esc(JSON.stringify(f))},${JSON.stringify(cmd)})">${esc(path.basename(f))}</div>`).join("")
          : `<div class="drop-item" style="opacity:0.5;cursor:default">No files</div>`;
        return `<div class="split-group" id="grp-${cmd}">
        <button class="split-main" onclick="sendAction(this,'${cmd}')"><span class="btn-label">${label}</span><span class="btn-check"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 71 60"><g transform="matrix(1,0,0,1,22.912,468)"><path d="M-22.912,-432.758 C-22.912,-432.758 4.151,-408 4.151,-408 C4.151,-408 48.666,-464.215 48.666,-464.215 C48.666,-464.215 44.151,-468 44.151,-468 C44.151,-468 4.151,-416 4.151,-416 C4.151,-416 -18.912,-436.758 -18.912,-436.758 Z" fill="#00b87b"/></g></svg></span></button>
        <button class="split-drop" onclick="toggleDrop(event,'${cmd}Drop')" title="Select target">▾</button>
        <div class="drop-menu" id="${cmd}Drop">${items}</div>
      </div>`;
      }).join("\n      ")}
      <button onclick="sendAction(this,'rtt')"><span class="btn-label">RTT Monitor</span><span class="btn-check"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 71 60"><g transform="matrix(1,0,0,1,22.912,468)"><path d="M-22.912,-432.758 C-22.912,-432.758 4.151,-408 4.151,-408 C4.151,-408 48.666,-464.215 48.666,-464.215 C48.666,-464.215 44.151,-468 44.151,-468 C44.151,-468 4.151,-416 4.151,-416 C4.151,-416 -18.912,-436.758 -18.912,-436.758 Z" fill="#00b87b"/></g></svg></span></button>
      <script>window.HIDDEN_COUNT = ${hidden.length};</script>
      <script src="${jsUri}"></script>
    </body>
    </html>`;
  }
}
