import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

import { getActiveBoard, getActiveBoardFile, setBoardElf, setupBoardDir, NewProjectConfig, NewProjectFile } from "./boardConfig";
import { getBoardDir } from "./projectConfig";

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("RustDyno Setup");
    }
    return outputChannel;
}

export interface ApplyResult {
    generated: string[];
    replaced: string[];
    skipped: string[];
    appended: string[];
}

export async function newProject(): Promise<void> {
    const board = getActiveBoard();
    if (!board) {
        vscode.window.showErrorMessage("No board selected. Select a board first.");
        return;
    }
    if (!board.new_project) {
        vscode.window.showErrorMessage(`Board "${board.board.name}" has no [new_project] section defined.`);
        return;
    }
    await runNewProject(board.new_project, board.board.name, board.probe?.protocol, getActiveBoardFile(), undefined, undefined);
}

export async function createNewProject(name: string, parentDir: string): Promise<void> {
    const board = getActiveBoard();
    if (!board?.new_project) { return; }
    await runNewProject(board.new_project, board.board.name, board.probe?.protocol, getActiveBoardFile(), name, parentDir);
}

async function runNewProject(np: NewProjectConfig, boardName: string, protocol: string | undefined, boardFile: string | undefined, nameArg: string | undefined, parentDirArg: string | undefined): Promise<void> {
    let parentDir = parentDirArg;
    let name = nameArg;

    if (!parentDir) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Create project here",
            title: "Choose parent folder for new project",
        });
        if (!picked || picked.length === 0) { return; }
        parentDir = picked[0].fsPath;
    }

    if (!name) {
        const input = await vscode.window.showInputBox({
            prompt: "Project name",
            placeHolder: "my-embedded-app",
            validateInput: (v) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v) ? undefined : "Use letters, numbers, _ or - (must start with a letter)",
        });
        if (!input) { return; }
        name = input;
    }

    const projectDir = path.join(parentDir, name);
    setBoardElf(name);

    // Run cargo new
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating ${name}…`, cancellable: false },
        async (progress) => {
            await runCargoNew(parentDir, name);

            progress.report({ message: "Writing project files…" });
            writeProjectFiles(projectDir, np.files ?? [], protocol, boardFile);
            quickCheckFiles(projectDir, np.files ?? []);

            progress.report({ message: "Adding dependencies…" });
            if (np.dependencies) {
                addDependencies(projectDir, np.dependencies);
            }
            const buildDeps = np["build-dependencies"];
            if (buildDeps) {
                addDependencies(projectDir, buildDeps);
            }
        }
    );

    vscode.window.showInformationMessage(`Project "${name}" created for ${boardName}.`);
    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectDir), { forceNewWindow: false });
}

export function applyBoardToProject(extensionPath: string): ApplyResult | undefined {
    const board = getActiveBoard();
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!board?.new_project?.files || !wsRoot) { return undefined; }

    // Ensure .rustdyno exists before applying
    setupBoardDir(extensionPath);

    const boardDir = getBoardDir();
    const backupDir = path.join(boardDir, "backup");
    const protocol = board.probe?.protocol;
    const boardFile = getActiveBoardFile();
    const np = board.new_project;
    const result: ApplyResult = { generated: [], replaced: [], skipped: [], appended: [] };

    for (const f of np.files ?? []) {
        const dest = path.join(wsRoot, f.path);
        const exists = fs.existsSync(dest);

        let content = f.content;
        if (protocol) { content = content.replaceAll("{{PROTOCOL}}", protocol); }
        if (boardFile) { content = content.replaceAll("{{BOARD_FILE}}", boardFile); }

        if (exists && f.append_if_exists) {
            const existing = fs.readFileSync(dest, "utf-8");
            fs.writeFileSync(dest, existing.trimEnd() + "\n" + content.trim() + "\n", "utf-8");
            result.appended.push(f.path);
            continue;
        }

        if (exists && !f.replace_if_exists) {
            result.skipped.push(f.path);
            continue;
        }

        if (exists) {
            // Backup existing file
            const backupPath = path.join(backupDir, f.path);
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            fs.copyFileSync(dest, backupPath);
            result.replaced.push(f.path);
        } else {
            result.generated.push(f.path);
        }

        // Write new content
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, "utf-8");
    }

    // Apply dependencies
    if (np.dependencies) {
        addDependencies(wsRoot, np.dependencies);
    }
    const buildDeps = np["build-dependencies"];
    if (buildDeps) {
        addDependencies(wsRoot, buildDeps);
    }

    return result;
}

export function showApplyResult(result: ApplyResult, boardName: string): void {
    const ch = getOutputChannel();
    ch.clear();
    ch.appendLine(`Board applied: ${boardName}`);
    ch.appendLine("─".repeat(40));

    if (result.generated.length) {
        ch.appendLine("\nGenerated (new files):");
        for (const f of result.generated) { ch.appendLine(`  + ${f}`); }
    }
    if (result.appended.length) {
        ch.appendLine("\nAppended (content added to existing file):");
        for (const f of result.appended) { ch.appendLine(`  >> ${f}`); }
    }
    if (result.replaced.length) {
        ch.appendLine("\nReplaced (backed up to .rustdyno/backup/):");
        for (const f of result.replaced) { ch.appendLine(`  ~ ${f}`); }
    }
    if (result.skipped.length) {
        ch.appendLine("\nSkipped (file exists, replace_if_exists = false):");
        for (const f of result.skipped) { ch.appendLine(`  - ${f}`); }
    }

    const parts: string[] = [];
    if (result.generated.length) { parts.push(`${result.generated.length} generated`); }
    if (result.appended.length) { parts.push(`${result.appended.length} appended`); }
    if (result.replaced.length) { parts.push(`${result.replaced.length} replaced`); }
    if (result.skipped.length) { parts.push(`${result.skipped.length} skipped`); }
    const summary = `Board "${boardName}" applied: ${parts.join(", ")}.`;

    vscode.window.showInformationMessage(summary, "Show Details").then(choice => {
        if (choice === "Show Details") { ch.show(); }
    });
}

function runCargoNew(parentDir: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(`cargo new --name ${name} ${name}`, { cwd: parentDir }, (err, _stdout, stderr) => {
            if (err) {
                vscode.window.showErrorMessage(`cargo new failed: ${stderr || err.message}`);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

export function writeProjectFiles(projectDir: string, files: NewProjectFile[], protocol?: string, boardFile?: string): void {
    for (const f of files) {
        const dest = path.join(projectDir, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        let content = f.content;
        if (protocol) { content = content.replaceAll("{{PROTOCOL}}", protocol); }
        if (boardFile) { content = content.replaceAll("{{BOARD_FILE}}", boardFile); }
        if (f.append_if_exists && fs.existsSync(dest)) {
            const existing = fs.readFileSync(dest, "utf-8");
            fs.writeFileSync(dest, existing.trimEnd() + "\n" + content.trim() + "\n", "utf-8");
        } else {
            fs.writeFileSync(dest, content, "utf-8");
        }
    }
}

function quickCheckFiles(projectDir: string, files: NewProjectFile[]): void {
    const ch = getOutputChannel();
    const missing = files.filter(f => !fs.existsSync(path.join(projectDir, f.path)));
    if (missing.length > 0) {
        ch.appendLine(`[WARN] ${missing.length} expected file(s) not written:`);
        for (const f of missing) { ch.appendLine(`  - ${f.path}`); }
    }
}

export function runGenerateCommand(command: string, projectName: string, location: string): void {
    const injected = command.replaceAll("{{PROJECT_NAME}}", projectName);
    const terminal = vscode.window.createTerminal({
        name: `Generate: ${projectName}`,
        cwd: location,
    });
    terminal.show();
    terminal.sendText(injected);
}

export function addDependencies(projectDir: string, deps: string): void {
    const cargoPath = path.join(projectDir, "Cargo.toml");
    if (!fs.existsSync(cargoPath)) { return; }
    try {
        const existing = fs.readFileSync(cargoPath, "utf-8");
        fs.writeFileSync(cargoPath, existing.trimEnd() + "\n" + deps.trim() + "\n", "utf-8");
    } catch (e) {
        vscode.window.showWarningMessage(`Could not update Cargo.toml: ${e}`);
    }
}
