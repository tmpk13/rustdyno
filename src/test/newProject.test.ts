import { mock, test, expect, beforeEach, afterEach } from "bun:test";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Mutable mock state so tests can configure boardConfig returns per-test
const mockState = {
    activeBoard: null as any,
    activeBoardFile: null as string | null,
    boardDir: "",
};

// vscode is mocked at the bundler level via src/test/setup.ts (bunfig.toml preload)
mock.module("../boardConfig", () => ({
    getActiveBoard: () => mockState.activeBoard,
    getActiveBoardFile: () => mockState.activeBoardFile,
    getBoardDir: () => mockState.boardDir,
    setBoardElf: () => {},
    setupBoardDir: () => {},
}));

import { writeProjectFiles, addDependencies, applyBoardToProject } from "../newProject";

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rdyno-test-"));
    mockState.activeBoard = null;
    mockState.activeBoardFile = null;
    mockState.boardDir = "";
    // Reset workspace folders
    (vscode.workspace as any).workspaceFolders = [];
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- writeProjectFiles ---

test("writeProjectFiles: creates files at specified paths", () => {
    const files = [
        { path: "src/main.rs", content: "fn main() {}" },
        { path: "Cargo.toml", content: "[package]" },
    ];
    writeProjectFiles(tmpDir, files as never);
    expect(fs.existsSync(path.join(tmpDir, "src/main.rs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Cargo.toml"))).toBe(true);
});

test("writeProjectFiles: creates nested directories", () => {
    const files = [{ path: ".cargo/config.toml", content: "[build]" }];
    writeProjectFiles(tmpDir, files as never);
    expect(fs.existsSync(path.join(tmpDir, ".cargo/config.toml"))).toBe(true);
});

test("writeProjectFiles: writes correct file content", () => {
    const expected = "#![no_std]\n#![no_main]\nfn main() -> ! { loop {} }";
    writeProjectFiles(tmpDir, [{ path: "src/main.rs", content: expected }] as never);
    const actual = fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8");
    expect(actual).toBe(expected);
});

test("writeProjectFiles: replaces {{PROTOCOL}} placeholder", () => {
    const files = [{ path: ".cargo/config.toml", content: 'runner = "probe-rs run --protocol {{PROTOCOL}}"' }];
    writeProjectFiles(tmpDir, files as never, "swd");
    const content = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(content).toContain("--protocol swd");
    expect(content).not.toContain("{{PROTOCOL}}");
});

test("writeProjectFiles: replaces {{BOARD_FILE}} placeholder", () => {
    const files = [{ path: "rustdyno.toml", content: 'default="{{BOARD_FILE}}"' }];
    writeProjectFiles(tmpDir, files as never, undefined, "microbit-v2.toml");
    const content = fs.readFileSync(path.join(tmpDir, "rustdyno.toml"), "utf-8");
    expect(content).toContain('default="microbit-v2.toml"');
    expect(content).not.toContain("{{BOARD_FILE}}");
});

test("writeProjectFiles: replaces both placeholders in one file", () => {
    const files = [{
        path: ".cargo/config.toml",
        content: 'runner = "probe-rs run --protocol {{PROTOCOL}}"\nboard = "{{BOARD_FILE}}"',
    }];
    writeProjectFiles(tmpDir, files as never, "swd", "stm32f1.toml");
    const content = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(content).toContain("--protocol swd");
    expect(content).toContain('board = "stm32f1.toml"');
});

test("writeProjectFiles: no replacement when protocol/boardFile absent", () => {
    const files = [{ path: "a.toml", content: 'runner = "{{PROTOCOL}}"' }];
    writeProjectFiles(tmpDir, files as never);
    const content = fs.readFileSync(path.join(tmpDir, "a.toml"), "utf-8");
    expect(content).toContain("{{PROTOCOL}}");
});

test("writeProjectFiles: handles all microbit-v2 board files", () => {
    const files = [
        { path: "rustdyno.toml", content: 'default="microbit-v2.toml"' },
        { path: "Embed.toml", content: '[default.general]\nchip = "nrf52833_xxAA"' },
        { path: "src/main.rs", content: "#![no_main]\n#![no_std]" },
        { path: ".cargo/config.toml", content: 'runner = "probe-rs run --protocol {{PROTOCOL}}"' },
    ];
    writeProjectFiles(tmpDir, files as never, "swd", "microbit-v2.toml");
    for (const f of files) {
        expect(fs.existsSync(path.join(tmpDir, f.path))).toBe(true);
    }
    const cargo = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(cargo).toContain("--protocol swd");
});

test("writeProjectFiles: handles esp32c3 board files", () => {
    const files = [
        { path: "rustdyno.toml", content: 'default="esp32c3.toml"' },
        { path: "src/main.rs", content: 'fn main() {}' },
        { path: "build.rs", content: 'fn main() { embuild::espidf::sysenv::output(); }' },
        { path: "rust-toolchain.toml", content: '[toolchain]\nchannel = "nightly"' },
        { path: "sdkconfig.defaults", content: "CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192" },
        { path: ".cargo/config.toml", content: '[build]\ntarget = "riscv32imc-esp-espidf"' },
    ];
    writeProjectFiles(tmpDir, files as never);
    for (const f of files) {
        expect(fs.existsSync(path.join(tmpDir, f.path))).toBe(true);
    }
});

// --- writeProjectFiles: append_if_exists ---

test("writeProjectFiles: append_if_exists appends to existing file", () => {
    const dest = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(dest, '[package]\nname = "test"\n');
    const files = [{ path: "Cargo.toml", content: '\n[dependencies]\nfoo = "1"\n', append_if_exists: true }];
    writeProjectFiles(tmpDir, files as never);
    const content = fs.readFileSync(dest, "utf-8");
    expect(content).toContain('name = "test"');
    expect(content).toContain('[dependencies]');
    expect(content).toContain('foo = "1"');
});

test("writeProjectFiles: append_if_exists creates file if not exists", () => {
    const files = [{ path: "new-file.toml", content: '[section]\nkey = "val"\n', append_if_exists: true }];
    writeProjectFiles(tmpDir, files as never);
    const content = fs.readFileSync(path.join(tmpDir, "new-file.toml"), "utf-8");
    expect(content).toContain('key = "val"');
});

test("writeProjectFiles: append_if_exists works with placeholders", () => {
    const dest = path.join(tmpDir, "config.toml");
    fs.writeFileSync(dest, '[build]\ntarget = "thumbv7"\n');
    const files = [{ path: "config.toml", content: 'runner = "probe-rs --protocol {{PROTOCOL}}"', append_if_exists: true }];
    writeProjectFiles(tmpDir, files as never, "swd");
    const content = fs.readFileSync(dest, "utf-8");
    expect(content).toContain('target = "thumbv7"');
    expect(content).toContain("--protocol swd");
});

test("writeProjectFiles: append_if_exists appends to file created by prior entry", () => {
    const files = [
        { path: "Cargo.toml", content: '[package]\nname = "test"\n' },
        { path: "Cargo.toml", content: '\n[dependencies]\nbar = "2"\n', append_if_exists: true },
    ];
    writeProjectFiles(tmpDir, files as never);
    const content = fs.readFileSync(path.join(tmpDir, "Cargo.toml"), "utf-8");
    expect(content).toContain('name = "test"');
    expect(content).toContain('[dependencies]');
    expect(content).toContain('bar = "2"');
});

// --- addDependencies ---

test("addDependencies: appends deps to existing Cargo.toml", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "test"\n');
    addDependencies(tmpDir, '\n[dependencies]\ncortex-m = "0.7"');
    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain("[dependencies]");
    expect(content).toContain('cortex-m = "0.7"');
});

test("addDependencies: appends after existing content without extra blank lines", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "test"\n');
    addDependencies(tmpDir, '[dependencies]\nfoo = "1"');
    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    // Should not have more than one blank line between sections
    expect(content).not.toMatch(/\n{3,}/);
});

test("addDependencies: does nothing when Cargo.toml is missing", () => {
    expect(() => addDependencies(tmpDir, '[dependencies]\nfoo = "1"')).not.toThrow();
});

test("addDependencies: preserves original content", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    const original = '[package]\nname = "myapp"\nversion = "0.1.0"\n';
    fs.writeFileSync(cargoPath, original);
    addDependencies(tmpDir, '[dependencies]\nbar = "2"');
    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain('name = "myapp"');
    expect(content).toContain('version = "0.1.0"');
});

test("addDependencies: handles multi-line dependency blocks", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "test"\n');
    const deps = `\n[dependencies]\ncortex-m = { version = "0.7", features = ["inline-asm"] }\ncortex-m-rt = "0.7"\nmicrobit-v2 = "0.16"\n`;
    addDependencies(tmpDir, deps);
    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain('cortex-m = { version = "0.7"');
    expect(content).toContain('microbit-v2 = "0.16"');
});

// --- applyBoardToProject ---

/** Helper: set up mocks so applyBoardToProject sees a board + workspace */
function setupApplyMocks(opts: {
    files: any[];
    dependencies?: string;
    "build-dependencies"?: string;
    protocol?: string;
    boardFile?: string;
}) {
    const boardDir = path.join(tmpDir, ".rustdyno");
    fs.mkdirSync(boardDir, { recursive: true });

    mockState.boardDir = boardDir;
    mockState.activeBoardFile = opts.boardFile ?? null;
    mockState.activeBoard = {
        board: { name: "test-board", chip: "test-chip", target: "test-target" },
        probe: opts.protocol ? { protocol: opts.protocol, speed: 4000 } : undefined,
        flash: {},
        rtt: { enabled: false, channels: [] },
        new_project: {
            files: opts.files,
            dependencies: opts.dependencies,
            "build-dependencies": opts["build-dependencies"],
        },
    };
    (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tmpDir }, name: "test", index: 0 },
    ];
}

test("applyBoardToProject: returns undefined when no board is active", () => {
    mockState.activeBoard = null;
    const result = applyBoardToProject("/ext");
    expect(result).toBeUndefined();
});

test("applyBoardToProject: returns undefined when no workspace is open", () => {
    mockState.activeBoard = {
        board: { name: "b", chip: "c", target: "t" },
        new_project: { files: [{ path: "a.txt", content: "hi" }] },
        flash: {}, rtt: { enabled: false, channels: [] },
    };
    (vscode.workspace as any).workspaceFolders = [];
    const result = applyBoardToProject("/ext");
    expect(result).toBeUndefined();
});

test("applyBoardToProject: returns undefined when board has no new_project files", () => {
    mockState.activeBoard = {
        board: { name: "b", chip: "c", target: "t" },
        new_project: { files: undefined },
        flash: {}, rtt: { enabled: false, channels: [] },
    };
    (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tmpDir }, name: "test", index: 0 },
    ];
    const result = applyBoardToProject("/ext");
    expect(result).toBeUndefined();
});

test("applyBoardToProject: generates new files in empty project", () => {
    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "#![no_std]\nfn main() {}" },
            { path: ".cargo/config.toml", content: "[build]\ntarget = \"thumbv7\"" },
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result).not.toBeUndefined();
    expect(result!.generated).toEqual(["src/main.rs", ".cargo/config.toml"]);
    expect(result!.replaced).toEqual([]);
    expect(result!.skipped).toEqual([]);
    expect(result!.appended).toEqual([]);

    // Verify file contents on disk
    const mainContent = fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8");
    expect(mainContent).toBe("#![no_std]\nfn main() {}");
    const cargoContent = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(cargoContent).toBe("[build]\ntarget = \"thumbv7\"");
});

test("applyBoardToProject: skips existing files when replace_if_exists is false", () => {
    // Pre-create an existing file
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), "original content");

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "new content", replace_if_exists: false },
            { path: "README.md", content: "# Hello" },
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.skipped).toEqual(["src/main.rs"]);
    expect(result!.generated).toEqual(["README.md"]);

    // Original file should be unchanged
    const content = fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8");
    expect(content).toBe("original content");
});

test("applyBoardToProject: skips existing files by default (no replace_if_exists set)", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), "original");

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "replaced" },  // no replace_if_exists
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.skipped).toEqual(["src/main.rs"]);
    expect(result!.replaced).toEqual([]);

    const content = fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8");
    expect(content).toBe("original");
});

test("applyBoardToProject: replaces existing files and creates backup when replace_if_exists is true", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), "original main.rs content");

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "#![no_std]\nfn main() {}", replace_if_exists: true },
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.replaced).toEqual(["src/main.rs"]);
    expect(result!.generated).toEqual([]);

    // New content should be written
    const newContent = fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8");
    expect(newContent).toBe("#![no_std]\nfn main() {}");

    // Backup should exist with original content
    const backupPath = path.join(tmpDir, ".rustdyno", "backup", "src/main.rs");
    expect(fs.existsSync(backupPath)).toBe(true);
    const backupContent = fs.readFileSync(backupPath, "utf-8");
    expect(backupContent).toBe("original main.rs content");
});

test("applyBoardToProject: backup preserves nested directory structure", () => {
    fs.mkdirSync(path.join(tmpDir, ".cargo"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".cargo/config.toml"), "original cargo config");

    setupApplyMocks({
        files: [
            { path: ".cargo/config.toml", content: "new config", replace_if_exists: true },
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.replaced).toEqual([".cargo/config.toml"]);

    const backupPath = path.join(tmpDir, ".rustdyno", "backup", ".cargo/config.toml");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe("original cargo config");
});

test("applyBoardToProject: backs up multiple files independently", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".cargo"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), "old main");
    fs.writeFileSync(path.join(tmpDir, ".cargo/config.toml"), "old config");

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "new main", replace_if_exists: true },
            { path: ".cargo/config.toml", content: "new config", replace_if_exists: true },
            { path: "Embed.toml", content: "[default]" },  // new file, no backup needed
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.replaced.sort()).toEqual([".cargo/config.toml", "src/main.rs"]);
    expect(result!.generated).toEqual(["Embed.toml"]);

    // Check each backup has the right original content
    expect(fs.readFileSync(path.join(tmpDir, ".rustdyno/backup/src/main.rs"), "utf-8")).toBe("old main");
    expect(fs.readFileSync(path.join(tmpDir, ".rustdyno/backup/.cargo/config.toml"), "utf-8")).toBe("old config");

    // No backup for newly generated files
    expect(fs.existsSync(path.join(tmpDir, ".rustdyno/backup/Embed.toml"))).toBe(false);
});

test("applyBoardToProject: appends to existing file with append_if_exists", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "myapp"\n');

    setupApplyMocks({
        files: [
            { path: "Cargo.toml", content: '\n[dependencies]\nfoo = "1"\n', append_if_exists: true },
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.appended).toEqual(["Cargo.toml"]);
    expect(result!.replaced).toEqual([]);
    expect(result!.skipped).toEqual([]);

    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain('name = "myapp"');
    expect(content).toContain('[dependencies]');
    expect(content).toContain('foo = "1"');
});

test("applyBoardToProject: append_if_exists does not create backup", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "myapp"\n');

    setupApplyMocks({
        files: [
            { path: "Cargo.toml", content: '[dependencies]\nbar = "2"', append_if_exists: true },
        ],
    });

    applyBoardToProject("/ext");

    // No backup should be created for appended files
    expect(fs.existsSync(path.join(tmpDir, ".rustdyno/backup/Cargo.toml"))).toBe(false);
});

test("applyBoardToProject: replaces placeholders in generated files", () => {
    setupApplyMocks({
        files: [
            { path: ".cargo/config.toml", content: 'runner = "probe-rs --protocol {{PROTOCOL}}"\nboard = "{{BOARD_FILE}}"' },
        ],
        protocol: "swd",
        boardFile: "nrf52.toml",
    });

    applyBoardToProject("/ext");

    const content = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(content).toContain("--protocol swd");
    expect(content).toContain('board = "nrf52.toml"');
    expect(content).not.toContain("{{PROTOCOL}}");
    expect(content).not.toContain("{{BOARD_FILE}}");
});

test("applyBoardToProject: replaces placeholders in replaced files", () => {
    fs.mkdirSync(path.join(tmpDir, ".cargo"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".cargo/config.toml"), "old content");

    setupApplyMocks({
        files: [
            { path: ".cargo/config.toml", content: 'protocol = "{{PROTOCOL}}"', replace_if_exists: true },
        ],
        protocol: "jtag",
    });

    applyBoardToProject("/ext");

    const content = fs.readFileSync(path.join(tmpDir, ".cargo/config.toml"), "utf-8");
    expect(content).toBe('protocol = "jtag"');
    expect(content).not.toContain("{{PROTOCOL}}");
});

test("applyBoardToProject: replaces placeholders in appended content", () => {
    const dest = path.join(tmpDir, "config.toml");
    fs.writeFileSync(dest, "[build]\n");

    setupApplyMocks({
        files: [
            { path: "config.toml", content: 'runner = "{{PROTOCOL}}"', append_if_exists: true },
        ],
        protocol: "swd",
    });

    applyBoardToProject("/ext");

    const content = fs.readFileSync(dest, "utf-8");
    expect(content).toContain("[build]");
    expect(content).toContain('runner = "swd"');
    expect(content).not.toContain("{{PROTOCOL}}");
});

test("applyBoardToProject: applies dependencies to Cargo.toml", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "test"\n');

    setupApplyMocks({
        files: [{ path: "src/main.rs", content: "fn main() {}" }],
        dependencies: '[dependencies]\ncortex-m = "0.7"',
    });

    applyBoardToProject("/ext");

    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain('cortex-m = "0.7"');
});

test("applyBoardToProject: applies build-dependencies to Cargo.toml", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(cargoPath, '[package]\nname = "test"\n');

    setupApplyMocks({
        files: [{ path: "src/main.rs", content: "fn main() {}" }],
        "build-dependencies": '[build-dependencies]\nembuild = "0.31"',
    });

    applyBoardToProject("/ext");

    const content = fs.readFileSync(cargoPath, "utf-8");
    expect(content).toContain('embuild = "0.31"');
});

test("applyBoardToProject: mixed scenario — generate, replace, skip, append in one call", () => {
    // Set up existing files
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), "old main");
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), '[package]\nname = "app"\n');
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My Project");

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "#![no_std]", replace_if_exists: true },    // replace
            { path: "Embed.toml", content: "[default]" },                                // generate
            { path: "README.md", content: "# Board README" },                            // skip (default)
            { path: "Cargo.toml", content: '[dependencies]\nfoo = "1"', append_if_exists: true },  // append
        ],
    });

    const result = applyBoardToProject("/ext");
    expect(result!.replaced).toEqual(["src/main.rs"]);
    expect(result!.generated).toEqual(["Embed.toml"]);
    expect(result!.skipped).toEqual(["README.md"]);
    expect(result!.appended).toEqual(["Cargo.toml"]);

    // Verify replaced file has new content + backup exists
    expect(fs.readFileSync(path.join(tmpDir, "src/main.rs"), "utf-8")).toBe("#![no_std]");
    expect(fs.readFileSync(path.join(tmpDir, ".rustdyno/backup/src/main.rs"), "utf-8")).toBe("old main");

    // Verify generated file exists
    expect(fs.readFileSync(path.join(tmpDir, "Embed.toml"), "utf-8")).toBe("[default]");

    // Verify skipped file is unchanged
    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf-8")).toBe("# My Project");

    // Verify appended file has both old and new content
    const cargo = fs.readFileSync(path.join(tmpDir, "Cargo.toml"), "utf-8");
    expect(cargo).toContain('name = "app"');
    expect(cargo).toContain('foo = "1"');
});

test("applyBoardToProject: backup content is byte-identical to original", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    const original = "#![no_std]\n#![no_main]\n\nuse cortex_m_rt::entry;\n\n#[entry]\nfn main() -> ! {\n    loop {}\n}\n";
    fs.writeFileSync(path.join(tmpDir, "src/main.rs"), original);

    setupApplyMocks({
        files: [
            { path: "src/main.rs", content: "replaced", replace_if_exists: true },
        ],
    });

    applyBoardToProject("/ext");

    const backup = fs.readFileSync(path.join(tmpDir, ".rustdyno/backup/src/main.rs"), "utf-8");
    expect(backup).toBe(original);
});
