import { mock, test, expect } from "bun:test";

// vscode is mocked at the bundler level via src/test/setup.ts (bunfig.toml preload)
mock.module("../boardConfig", () => ({
    getActiveBoard: () => null,
    getEffectivePort: () => null,
    selectBoard: async () => null,
}));

mock.module("../filePicker", () => ({
    getActiveFile: () => null,
}));

import { parseProgress, stripAnsi } from "../flasher";

// --- stripAnsi ---

test("stripAnsi: removes basic color codes", () => {
    expect(stripAnsi("\x1b[32mGreen\x1b[0m")).toBe("Green");
});

test("stripAnsi: removes bold/reset codes", () => {
    expect(stripAnsi("\x1b[1mBold\x1b[0m")).toBe("Bold");
});

test("stripAnsi: handles multi-param sequences", () => {
    expect(stripAnsi("\x1b[1;32mBold Green\x1b[0m")).toBe("Bold Green");
});

test("stripAnsi: passthrough on plain text", () => {
    expect(stripAnsi("Erasing 45%")).toBe("Erasing 45%");
});

test("stripAnsi: removes cursor movement codes", () => {
    expect(stripAnsi("\x1b[2K\x1b[1AProgramming 80%")).toBe("Programming 80%");
});

// --- parseProgress ---

test("parseProgress: detects Erasing phase", () => {
    const result = parseProgress("Erasing 45%");
    expect(result).toEqual({ phase: "erasing", pct: 45 });
});

test("parseProgress: detects Programming phase", () => {
    const result = parseProgress("Programming 90%");
    expect(result).toEqual({ phase: "programming", pct: 90 });
});

test("parseProgress: case insensitive", () => {
    expect(parseProgress("erasing 10%")).toEqual({ phase: "erasing", pct: 10 });
    expect(parseProgress("PROGRAMMING 50%")).toEqual({ phase: "programming", pct: 50 });
});

test("parseProgress: strips ANSI before matching", () => {
    const result = parseProgress("\x1b[32mErasing\x1b[0m 72%");
    expect(result).toEqual({ phase: "erasing", pct: 72 });
});

test("parseProgress: handles probe-rs checkmark format", () => {
    // probe-rs outputs "Erasing ✔ 100%" style
    const result = parseProgress("Erasing ✔ 100%");
    expect(result).toEqual({ phase: "erasing", pct: 100 });
});

test("parseProgress: handles space before percentage", () => {
    const result = parseProgress("Programming   33%");
    expect(result).toEqual({ phase: "programming", pct: 33 });
});

test("parseProgress: returns null for non-progress lines", () => {
    expect(parseProgress("Flashing target chip...")).toBeNull();
    expect(parseProgress("")).toBeNull();
    expect(parseProgress("error: failed to connect")).toBeNull();
    expect(parseProgress("Finished in 2.3s")).toBeNull();
});

test("parseProgress: returns null for partial matches", () => {
    expect(parseProgress("Progress: 50")).toBeNull();
    expect(parseProgress("45%")).toBeNull();
});

test("parseProgress: 0% boundary", () => {
    expect(parseProgress("Erasing 0%")).toEqual({ phase: "erasing", pct: 0 });
});

test("parseProgress: 100% boundary", () => {
    expect(parseProgress("Programming 100%")).toEqual({ phase: "programming", pct: 100 });
});
