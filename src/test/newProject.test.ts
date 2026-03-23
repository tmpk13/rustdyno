import { mock, test, expect, beforeEach, afterEach } from "bun:test";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

// vscode is mocked at the bundler level via src/test/setup.ts (bunfig.toml preload)
mock.module("../boardConfig", () => ({
    getActiveBoard: () => null,
    getActiveBoardFile: () => null,
    getBoardDir: () => "",
    setBoardElf: () => {},
    setupBoardDir: () => {},
}));

import { writeProjectFiles, addDependencies } from "../newProject";

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rdyno-test-"));
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
