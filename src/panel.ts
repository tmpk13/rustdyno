import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { autoSelectBoard, getActiveBoard, getActiveBoardFile, getBoardDir, getEffectivePort, getLayout, getPortOverride, getDefaultTargetFile, listBoards, PanelLayout, selectBoardByFile, setDefaultBoardFile, setDefaultTargetFile, setLayout, setPortOverride, getProbeMap, setProbeMapping, clearProbeBoard, setupBoardDir, ToolInstallConfig, getPanelBg, setPanelBg, getCargoTargets, BinTarget } from "./boardConfig";

const DEFAULT_ACTIONS: Record<string, { label: string; color: string }> = {
    build: { label: "Build", color: "#1e7ec8" },
    flash: { label: "Flash", color: "#d1a618" },
    rtt:   { label: "RTT Monitor", color: "#4caf50" },
};
import { getActiveFile, getCachedFiles, getHiddenFiles, hideFile, openFile, refreshFiles, reorderFiles, unhideFile } from "./filePicker";
import { fetchLibraryList, downloadBoardToWorkspace, addBoardFromCache, listCachedBoards, isBoardInWorkspace, removeBoard, fetchBoardContent, getWorkspaceBoardContent, updateBoardInWorkspace, fetchExamplesList } from "./boardLibrary";
import { createNewProject, applyBoardToProject, showApplyResult, runGenerateCommand } from "./newProject";
import { flash } from "./flasher";
import { runCheckAndClippy } from "./checker";

function loadHtml(ext: vscode.ExtensionContext, webview: vscode.Webview, htmlFile: string, jsFile: string): string {
    const mediaPath = vscode.Uri.joinPath(ext.extensionUri, "media");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, "panel.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, jsFile));
    const dropUri = webview.asWebviewUri(vscode.Uri.joinPath(ext.extensionUri, "imgs", "drop.svg"));
    const htmlPath = path.join(ext.extensionUri.fsPath, "media", htmlFile);
    return fs.readFileSync(htmlPath, "utf8")
        .replace("{{CSS_URI}}", cssUri.toString())
        .replace("{{JS_URI}}", jsUri.toString())
        .replace(/\{\{DROP_URI\}\}/g, dropUri.toString());
}

export class BoardPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rustdyno.panel";

    private view?: vscode.WebviewView;
    private _pollInterval: NodeJS.Timeout | undefined;
    private _seenProbeIds = new Set<string>();
    private _checkEnabled: boolean = false;
    private _checkPanel: vscode.WebviewPanel | undefined;

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
        this._checkEnabled = this.ext.workspaceState.get<boolean>("checkEnabled", false);

        if (!getActiveBoard()) { autoSelectBoard(); }
        const savedTarget = getDefaultTargetFile();
        if (savedTarget) {
            openFile(savedTarget);
        } else {
            const targets = getCargoTargets();
            const main = targets.find(t => t.path === "src/main.rs") ?? targets[0];
            if (main) { openFile(main.path); }
        }
        view.webview.html = this.getHtml();
        this.sendState();
        this.sendLibrarySetup();
        this.sendNewProjectState();

        refreshFiles().then(() => { this.sendState(); });

        this.startPolling(view);
        view.onDidDispose(() => {
            if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = undefined; }
        });

        view.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                // ── Board Controls ──
                case "selectBoard":
                    selectBoardByFile(msg.data);
                    setDefaultBoardFile(msg.data);
                    this.sendState();
                    break;
                case "selectFile": {
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
                case "setPanelBg":
                    setPanelBg(msg.data as string | undefined);
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
                    const probePath = vscode.workspace.getConfiguration("rustdyno").get<string>("probersPath", "probe-rs");
                    exec(`${probePath} list`, (_err, stdout) => {
                        const ports: { id: string; label: string }[] = [];
                        for (const line of stdout.split("\n")) {
                            const m = line.match(/^\[\d+\]:\s*(.+?)\s*--\s*(\S+)/);
                            if (m) { ports.push({ id: m[2], label: m[1].trim() }); }
                        }
                        view.webview.postMessage({ command: "ports", data: ports });
                    });
                    break;
                }
                case "refresh":
                    refreshFiles().then(() => { this.sendState(); });
                    break;
                case "build": vscode.commands.executeCommand("rustdyno.build"); break;
                case "flash":
                    flash(event => view.webview.postMessage({ command: "flashProgress", data: event }));
                    break;
                case "rtt": vscode.commands.executeCommand("rustdyno.rtt"); break;
                case "selectAndRun": {
                    openFile(msg.data.file);
                    this.sendState();
                    vscode.commands.executeCommand(`rustdyno.${msg.data.cmd}`);
                    break;
                }
                case "nameProbe": {
                    const { probeId, name, boardFile } = msg.data as { probeId: string; name: string; boardFile?: string };
                    setProbeMapping(probeId, name, boardFile);
                    break;
                }
                case "clearProbeBoard": {
                    const { probeId } = msg.data as { probeId: string };
                    clearProbeBoard(probeId);
                    break;
                }
                case "toggleCheck": {
                    this._checkEnabled = !this._checkEnabled;
                    this.ext.workspaceState.update("checkEnabled", this._checkEnabled);
                    this.sendState();
                    break;
                }
                case "runCheck": {
                    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (!wsRoot) {
                        vscode.window.showErrorMessage("No workspace folder open.");
                        break;
                    }
                    if (!this._checkPanel) {
                        this._checkPanel = vscode.window.createWebviewPanel(
                            "rustdyno.checkResults",
                            "Cargo Check & Clippy",
                            vscode.ViewColumn.One,
                            {
                                enableScripts: true,
                                localResourceRoots: [vscode.Uri.joinPath(this.ext.extensionUri, "media")],
                                retainContextWhenHidden: true,
                            }
                        );
                        this._checkPanel.webview.html = this._getCheckHtml(this._checkPanel.webview);
                        this._checkPanel.onDidDispose(() => { this._checkPanel = undefined; });
                        this._checkPanel.webview.onDidReceiveMessage(async (m) => {
                            if (m.command === "openFile") {
                                const { path: filePath, line, column } = m.data as { path: string; line: number; column: number };
                                try {
                                    const uri = vscode.Uri.file(filePath);
                                    const doc = await vscode.workspace.openTextDocument(uri);
                                    const pos = new vscode.Position(line - 1, Math.max(0, column - 1));
                                    await vscode.window.showTextDocument(doc, {
                                        selection: new vscode.Range(pos, pos),
                                        preview: false,
                                    });
                                } catch {
                                    vscode.window.showErrorMessage(`Could not open: ${filePath}`);
                                }
                            } else if (m.command === "rerun") {
                                this._doRunCheck(wsRoot, view);
                            }
                        });
                    } else {
                        this._checkPanel.reveal(vscode.ViewColumn.One);
                    }
                    this._doRunCheck(wsRoot, view);
                    break;
                }
                case "installProbeRs": {
                    const platform = process.platform;
                    const items: vscode.QuickPickItem[] = [];
                    if (platform !== "win32") {
                        items.push({
                            label: "$(terminal) Install probe-rs",
                            description: "Linux / macOS — curl installer",
                            detail: "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/probe-rs/probe-rs/releases/latest/download/probe-rs-tools-installer.sh | sh",
                        });
                    }
                    if (platform === "linux") {
                        items.push({
                            label: "$(check) Complete install",
                            description: "Linux — installs udev rules (run after installing)",
                            detail: "probe-rs complete install",
                        });
                    }
                    if (platform === "win32") {
                        items.push({
                            label: "$(terminal) Install probe-rs",
                            description: "Windows — PowerShell installer",
                            detail: 'powershell -ExecutionPolicy ByPass -c "irm https://github.com/probe-rs/probe-rs/releases/latest/download/probe-rs-tools-installer.ps1 | iex"',
                        });
                    }
                    const picked = await vscode.window.showQuickPick(items, {
                        placeHolder: "Select a command to copy to clipboard",
                    });
                    if (picked?.detail) {
                        await vscode.env.clipboard.writeText(picked.detail);
                        vscode.window.showInformationMessage("Install command copied to clipboard.");
                    }
                    break;
                }

                // ── Tool Install ──
                case "checkTool": {
                    const tool = getActiveBoard()?.tool;
                    if (!tool) { break; }
                    const checkCmd = tool.check ?? `${tool.name} --version`;
                    exec(checkCmd, (err) => {
                        const found = !err;
                        view.webview.postMessage({ command: "toolStatus", data: { found } });
                    });
                    break;
                }
                case "installTool": {
                    const tool = getActiveBoard()?.tool;
                    if (!tool?.install) { break; }
                    const plat = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
                    const cmd = tool.install[plat];
                    if (!cmd) {
                        vscode.window.showErrorMessage(`No install command for platform: ${plat}`);
                        view.webview.postMessage({ command: "toolInstallResult", data: { success: false } });
                        break;
                    }
                    const successMsg = tool.success_message;
                    exec(cmd, { timeout: 120000 }, (err) => {
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to install ${tool.name}: ${err.message}`);
                            view.webview.postMessage({ command: "toolInstallResult", data: { success: false } });
                        } else {
                            view.webview.postMessage({ command: "toolInstallResult", data: { success: true, message: successMsg } });
                        }
                    });
                    break;
                }

                // ── Board Library ──
                case "fetchLibrary": {
                    const repo = vscode.workspace.getConfiguration("rustdyno").get<string>("boardLibraryRepo", "");
                    if (!repo) {
                        view.webview.postMessage({ command: "libraryError", data: "No repo configured. Set rustdyno.boardLibraryRepo in settings." });
                        return;
                    }
                    try {
                        let entries: import("./boardLibrary").LibraryEntry[];
                        let offline = false;
                        try {
                            entries = await fetchLibraryList(repo);
                        } catch {
                            offline = true;
                            entries = listCachedBoards().map(name => ({ name, path: name, downloadUrl: "" }));
                        }
                        const withStatus = await Promise.all(entries.map(async e => {
                            const inWorkspace = isBoardInWorkspace(e.name);
                            let hasUpdate = false;
                            if (inWorkspace && !offline) {
                                try {
                                    const localContent = getWorkspaceBoardContent(e.name);
                                    const remoteContent = await fetchBoardContent(e.downloadUrl);
                                    hasUpdate = localContent !== undefined && localContent.trim() !== remoteContent.trim();
                                } catch { /* ignore update check failure */ }
                            }
                            return { ...e, inWorkspace, hasUpdate };
                        }));
                        view.webview.postMessage({ command: "libraryList", data: withStatus });
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error("[rustdyno] fetchLibrary error:", errMsg);
                        view.webview.postMessage({ command: "libraryError", data: `Failed to fetch library: ${errMsg}` });
                    }
                    break;
                }
                case "downloadBoard": {
                    const { name, downloadUrl } = msg.data as { name: string; downloadUrl: string };
                    try {
                        if (downloadUrl) {
                            await downloadBoardToWorkspace(name, downloadUrl);
                        } else {
                            addBoardFromCache(name);
                        }
                        view.webview.postMessage({ command: "boardAddedToProject", data: name });
                        vscode.window.showInformationMessage(`Board added to project: ${name}`);
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "boardError", data: { name, error: errMsg } });
                        vscode.window.showErrorMessage(`Failed to download board: ${errMsg}`);
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
                case "forceDownloadAll": {
                    const repo = vscode.workspace.getConfiguration("rustdyno").get<string>("boardLibraryRepo", "");
                    if (!repo) {
                        view.webview.postMessage({ command: "libraryError", data: "No repo configured. Set rustdyno.boardLibraryRepo in settings." });
                        return;
                    }
                    try {
                        const entries = await fetchLibraryList(repo);
                        const workspace = entries.filter(e => isBoardInWorkspace(e.name));
                        await Promise.all(workspace.map(e => updateBoardInWorkspace(e.name, e.downloadUrl)));
                        view.webview.postMessage({ command: "forceDownloadDone" });
                        vscode.window.showInformationMessage(`Updated ${workspace.length} board(s) from GitHub.`);
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "libraryError", data: `Force download failed: ${errMsg}` });
                        vscode.window.showErrorMessage(`Force download failed: ${errMsg}`);
                    }
                    break;
                }
                case "openSettings": {
                    vscode.commands.executeCommand("workbench.action.openSettings", "rustdyno.boardLibraryRepo");
                    break;
                }

                // ── Examples ──
                case "fetchExamples": {
                    const repo = vscode.workspace.getConfiguration("rustdyno").get<string>("boardLibraryRepo", "");
                    if (!repo) {
                        view.webview.postMessage({ command: "examplesError", data: "No repo configured. Set rustdyno.boardLibraryRepo in settings." });
                        return;
                    }
                    try {
                        const examples = await fetchExamplesList(repo);
                        view.webview.postMessage({ command: "examplesList", data: examples });
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        view.webview.postMessage({ command: "examplesError", data: `Failed to fetch examples: ${errMsg}` });
                    }
                    break;
                }
                case "openExample": {
                    const { codeContent } = msg.data as { name: string; codePath: string; codeContent: string };
                    const doc = await vscode.workspace.openTextDocument({
                        content: codeContent,
                        language: "rust",
                    });
                    await vscode.window.showTextDocument(doc, { preview: false });
                    break;
                }

                // ── New Project ──
                case "npRefreshBoards":
                    this.sendNewProjectState();
                    break;
                case "npSelectBoard":
                    selectBoardByFile(msg.data);
                    setDefaultBoardFile(msg.data);
                    this.sendNewProjectState();
                    this.sendState();
                    break;
                case "browseFolder": {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: "Select folder",
                    });
                    if (picked?.[0]) {
                        view.webview.postMessage({ command: "browseResult", data: picked[0].fsPath });
                    }
                    break;
                }
                case "createProject": {
                    const { name, location } = msg.data as { name: string; location: string };
                    setupBoardDir(this.ext.extensionUri.fsPath);
                    createNewProject(name, location);
                    break;
                }
                case "setup":
                    setupBoardDir(this.ext.extensionUri.fsPath);
                    vscode.window.showInformationMessage("Board config directory created.");
                    this.sendNewProjectState();
                    break;
                case "applyBoard": {
                    const board = getActiveBoard();
                    if (!board?.new_project) {
                        vscode.window.showErrorMessage("No board with [new_project] config selected.");
                        return;
                    }
                    const result = applyBoardToProject(this.ext.extensionUri.fsPath);
                    if (result) {
                        showApplyResult(result, board.board.name);
                    }
                    break;
                }

                case "browseGenFolder": {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: "Select folder",
                    });
                    if (picked?.[0]) {
                        view.webview.postMessage({ command: "browseGenResult", data: picked[0].fsPath });
                    }
                    break;
                }
                case "generateProject": {
                    const { name, location, command } = msg.data as { name: string; location: string; command: string };
                    runGenerateCommand(command, name, location);
                    break;
                }

                // ── Board Maker ──
                case "saveBoard": {
                    const { filename, content } = msg.data as { filename: string; content: string };
                    const dir = getBoardDir();
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    const filePath = path.join(dir, filename);
                    if (fs.existsSync(filePath)) {
                        const overwrite = await vscode.window.showWarningMessage(
                            `${filename} already exists. Overwrite?`,
                            "Overwrite", "Cancel"
                        );
                        if (overwrite !== "Overwrite") {
                            view.webview.postMessage({ command: "saveError", data: "Save cancelled." });
                            return;
                        }
                    }
                    fs.writeFileSync(filePath, content, "utf-8");
                    view.webview.postMessage({ command: "saved" });
                    vscode.window.showInformationMessage(`Board saved: ${filename}`);
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
                binTargets: getCargoTargets() as BinTarget[],
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
                    down: uri("imgs/down.svg"),
                },
                tool: getActiveBoard()?.tool ?? null,
                layout: getLayout() ?? null,
                checkEnabled: this._checkEnabled,
                panelBg: getPanelBg() ?? null,
            },
        });
    }

    private sendLibrarySetup() {
        if (!this.view) { return; }
        const webview = this.view.webview;
        const uri = (rel: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, rel)).toString();
        webview.postMessage({
            command: "libSetup",
            uris: {
                check: uri("imgs/check.svg"),
                down: uri("imgs/down.svg"),
                refresh: uri("imgs/refresh.svg"),
            },
        });
    }

    private sendNewProjectState() {
        if (!this.view) { return; }
        const webview = this.view.webview;
        const uri = (rel: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, rel)).toString();
        const board = getActiveBoard();

        const generateRaw = board?.new_project?.generate;
        let generateCommands: { label: string; command: string }[] | null = null;
        if (typeof generateRaw === "string" && generateRaw.trim()) {
            generateCommands = [{ label: "Generate", command: generateRaw }];
        } else if (Array.isArray(generateRaw) && generateRaw.length > 0) {
            generateCommands = generateRaw as { label: string; command: string }[];
        }

        webview.postMessage({
            command: "npInit",
            data: {
                hasConfig: !!(board?.new_project?.files?.length || board?.new_project?.dependencies),
                hasBoardDir: fs.existsSync(getBoardDir()),
                boardName: board?.board.name ?? "no board selected",
                boards: listBoards(),
                activeBoardFile: getActiveBoardFile(),
                generateCommands,
                uris: { drop: uri("imgs/drop.svg"), refresh: uri("imgs/refresh.svg") },
            },
        });
    }

    private _doRunCheck(wsRoot: string, view: vscode.WebviewView) {
        if (!this._checkPanel) { return; }
        this._checkPanel.webview.postMessage({ command: "checkRunning" });
        view.webview.postMessage({ command: "checkRunning" });
        runCheckAndClippy(wsRoot).then((result) => {
            this._checkPanel?.webview.postMessage({ command: "checkResults", data: result });
            view.webview.postMessage({ command: "checkDone" });
        }).catch((err: unknown) => {
            vscode.window.showErrorMessage(`cargo check failed: ${err}`);
            view.webview.postMessage({ command: "checkDone" });
        });
    }

    private _getCheckHtml(webview: vscode.Webview): string {
        const media = vscode.Uri.joinPath(this.ext.extensionUri, "media");
        const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "check.css")).toString();
        const js  = webview.asWebviewUri(vscode.Uri.joinPath(media, "check.js")).toString();
        const htmlPath = path.join(this.ext.extensionUri.fsPath, "media", "check.html");
        return fs.readFileSync(htmlPath, "utf8")
            .replace("{{CSS_URI}}", css)
            .replace("{{JS_URI}}", js)
            .replace(/\{\{WEBVIEW_CSP_SOURCE\}\}/g, webview.cspSource);
    }

    private startPolling(view: vscode.WebviewView) {
        const probePath = vscode.workspace.getConfiguration("rustdyno").get<string>("probersPath", "probe-rs");
        const poll = () => {
            const board = getActiveBoard();
            if (!board?.probe) {
                view.webview.postMessage({ command: "probeRsStatus", data: { installed: true } });
                view.webview.postMessage({ command: "probeStatus", data: { connected: false, probes: [], probeMap: {} } });
                return;
            }
            exec(`${probePath} list`, (err, stdout) => {
                const notInstalled = !!err && (
                    err.message.toLowerCase().match(/not found|no such file|cannot find/) !== null ||
                    String((err as NodeJS.ErrnoException).code) === "127"
                );
                if (notInstalled) {
                    view.webview.postMessage({ command: "probeRsStatus", data: { installed: false } });
                    return;
                }
                view.webview.postMessage({ command: "probeRsStatus", data: { installed: true } });

                const probes: { id: string; label: string }[] = [];
                for (const line of stdout.split("\n")) {
                    const m = line.match(/^\[\d+\]:\s*(.+?)\s*--\s*(\S+)/);
                    if (m) { probes.push({ id: m[2], label: m[1].trim() }); }
                }
                const port = getEffectivePort();
                const connected = port ? probes.some(p => p.id === port) : probes.length > 0;

                const probeMap = getProbeMap();
                for (const probe of probes) {
                    if (!this._seenProbeIds.has(probe.id)) {
                        const mapping = probeMap[probe.id];
                        if (mapping?.board) {
                            selectBoardByFile(mapping.board);
                            setDefaultBoardFile(mapping.board);
                            this.sendState();
                        }
                    }
                }
                this._seenProbeIds = new Set(probes.map(p => p.id));

                view.webview.postMessage({ command: "probeStatus", data: { connected, probes, probeMap } });
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
        const probePath = vscode.workspace.getConfiguration("rustdyno").get<string>("probersPath", "probe-rs");
        const port = getEffectivePort();
        const portFlag = port ? ` --probe ${port}` : "";
        switch (cmd) {
            case "build":
                if (!board) { return "cargo build --release"; }
                return `cargo build --release --target ${board.board.target}`;
            case "flash":
                if (!board) { return `${probePath} run ...`; }
                if (board.run?.command) { return board.run.command; }
                if (board.new_project?.runner) { return `cargo run --release`; }
                if (!board.probe) { return "(no flash command configured)"; }
                return `${probePath} run --chip ${board.board.chip} --protocol ${board.probe.protocol} --speed ${board.probe.speed}${portFlag} target/${board.board.target}/release/<crate>`;
            case "rtt":
                if (!board) { return `${probePath} attach ...`; }
                if (board.rtt?.command) { return board.rtt.command; }
                if (!board.probe) { return "(no monitor command configured)"; }
                return `${probePath} attach --chip ${board.board.chip} --protocol ${board.probe.protocol}${portFlag}`;
            default:
                return cmd;
        }
    }

    private getHtml(): string {
        return loadHtml(this.ext, this.view!.webview, "panel.html", "panel.js");
    }
}
