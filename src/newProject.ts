import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

import { getActiveBoard, setBoardElf } from "./boardConfig";

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

    const np = board.new_project;

    // Ask for parent directory
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Create project here",
        title: "Choose parent folder for new project",
    });
    if (!picked || picked.length === 0) { return; }
    const parentDir = picked[0].fsPath;

    // Ask for project name
    const name = await vscode.window.showInputBox({
        prompt: "Project name",
        placeHolder: "my-embedded-app",
        validateInput: (v) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v) ? undefined : "Use letters, numbers, _ or - (must start with a letter)",
    });
    if (!name) { return; }

    const projectDir = path.join(parentDir, name);
    setBoardElf(name);

    // Run cargo new
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating ${name}…`, cancellable: false },
        async (progress) => {
            await runCargoNew(parentDir, name);

            progress.report({ message: "Writing project files…" });
            writeProjectFiles(projectDir, np.files ?? []);

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

    vscode.window.showInformationMessage(`Project "${name}" created for ${board.board.name}.`);
    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectDir), { forceNewWindow: false });
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

function writeProjectFiles(projectDir: string, files: { path: string; content: string }[]): void {
    for (const f of files) {
        const dest = path.join(projectDir, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content, "utf-8");
    }
}

function addDependencies(projectDir: string, deps: string): void {
    const cargoPath = path.join(projectDir, "Cargo.toml");
    if (!fs.existsSync(cargoPath)) { return; }
    try {
        const existing = fs.readFileSync(cargoPath, "utf-8");
        fs.writeFileSync(cargoPath, existing.trimEnd() + "\n" + deps.trim() + "\n", "utf-8");
    } catch (e) {
        vscode.window.showWarningMessage(`Could not update Cargo.toml: ${e}`);
    }
}
