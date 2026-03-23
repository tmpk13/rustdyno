import { test, expect } from "bun:test";

// vscode is mocked at the bundler level via src/test/setup.ts (bunfig.toml preload)

import { rankSpan, processSpans, processDiagnostic } from "../checker";
import type { CargoSpan, CargoDiagnostic } from "../checker";

const WS = "/home/user/myproject";

function makeSpan(overrides: Partial<CargoSpan>): CargoSpan {
    return {
        file_name: "src/main.rs",
        line_start: 1,
        column_start: 1,
        line_end: 1,
        column_end: 10,
        is_primary: true,
        label: null,
        text: [],
        ...overrides,
    };
}

function makeDiag(overrides: Partial<CargoDiagnostic>): CargoDiagnostic {
    return {
        message: "unused variable",
        level: "warning",
        spans: [],
        children: [],
        rendered: "warning: unused variable",
        code: { code: "unused_variables" },
        ...overrides,
    };
}

// --- rankSpan ---

test("rankSpan: primary relative source file ranks 0", () => {
    const span = makeSpan({ file_name: "src/main.rs", is_primary: true });
    expect(rankSpan(span, WS)).toBe(0);
});

test("rankSpan: non-primary relative source file ranks 1", () => {
    const span = makeSpan({ file_name: "src/lib.rs", is_primary: false });
    expect(rankSpan(span, WS)).toBe(1);
});

test("rankSpan: cargo registry file ranks 2", () => {
    const span = makeSpan({ file_name: "/home/user/.cargo/registry/src/foo/lib.rs", is_primary: true });
    expect(rankSpan(span, WS)).toBe(2);
});

test("rankSpan: cargo git dependency ranks 2", () => {
    const span = makeSpan({ file_name: "/home/user/.cargo/git/checkouts/foo/lib.rs", is_primary: true });
    expect(rankSpan(span, WS)).toBe(2);
});

test("rankSpan: relative target/ file ranks 3", () => {
    const span = makeSpan({ file_name: "target/debug/build/foo.rs", is_primary: true });
    expect(rankSpan(span, WS)).toBe(3);
});

test("rankSpan: absolute target/ file ranks 3", () => {
    const span = makeSpan({ file_name: `${WS}/target/debug/build/foo.rs`, is_primary: true });
    expect(rankSpan(span, WS)).toBe(3);
});

test("rankSpan: primary absolute project file ranks 0", () => {
    const span = makeSpan({ file_name: `${WS}/src/main.rs`, is_primary: true });
    expect(rankSpan(span, WS)).toBe(0);
});

test("rankSpan: non-primary absolute project file ranks 1", () => {
    const span = makeSpan({ file_name: `${WS}/src/lib.rs`, is_primary: false });
    expect(rankSpan(span, WS)).toBe(1);
});

// --- processSpans ---

test("processSpans: sorts spans by rank ascending", () => {
    const spans = [
        makeSpan({ file_name: "target/build.rs", is_primary: false }),   // rank 3
        makeSpan({ file_name: "src/lib.rs", is_primary: false }),         // rank 1
        makeSpan({ file_name: "src/main.rs", is_primary: true }),         // rank 0
    ];
    const sorted = processSpans(spans, WS);
    expect(sorted[0].rank).toBe(0);
    expect(sorted[1].rank).toBe(1);
    expect(sorted[2].rank).toBe(3);
});

test("processSpans: sets abs_path for relative files", () => {
    const spans = [makeSpan({ file_name: "src/main.rs" })];
    const sorted = processSpans(spans, WS);
    expect(sorted[0].abs_path).toBe(`${WS}/src/main.rs`);
});

test("processSpans: preserves abs_path for absolute files", () => {
    const abs = `${WS}/src/lib.rs`;
    const spans = [makeSpan({ file_name: abs })];
    const sorted = processSpans(spans, WS);
    expect(sorted[0].abs_path).toBe(abs);
});

test("processSpans: handles empty spans array", () => {
    expect(processSpans([], WS)).toEqual([]);
});

test("processSpans: attaches rank to each span", () => {
    const spans = [
        makeSpan({ file_name: "src/main.rs", is_primary: true }),
        makeSpan({ file_name: "/home/user/.cargo/registry/src/foo.rs" }),
    ];
    const sorted = processSpans(spans, WS);
    expect(sorted.every(s => "rank" in s)).toBe(true);
});

// --- processDiagnostic ---

test("processDiagnostic: maps message and level", () => {
    const diag = makeDiag({ message: "unused variable `x`", level: "warning" });
    const result = processDiagnostic(diag, WS, "check");
    expect(result.message).toBe("unused variable `x`");
    expect(result.level).toBe("warning");
});

test("processDiagnostic: sets source correctly", () => {
    const diag = makeDiag({});
    expect(processDiagnostic(diag, WS, "check").source).toBe("check");
    expect(processDiagnostic(diag, WS, "clippy").source).toBe("clippy");
});

test("processDiagnostic: extracts code string", () => {
    const diag = makeDiag({ code: { code: "E0308" } });
    expect(processDiagnostic(diag, WS, "check").code).toBe("E0308");
});

test("processDiagnostic: code is null when absent", () => {
    const diag = makeDiag({ code: null });
    expect(processDiagnostic(diag, WS, "check").code).toBeNull();
});

test("processDiagnostic: includes rendered string", () => {
    const diag = makeDiag({ rendered: "warning: unused variable\n --> src/main.rs:5:9" });
    const result = processDiagnostic(diag, WS, "check");
    expect(result.rendered).toContain("unused variable");
});

test("processDiagnostic: processes and sorts spans", () => {
    const diag = makeDiag({
        spans: [
            makeSpan({ file_name: "target/build.rs", is_primary: false }),
            makeSpan({ file_name: "src/main.rs", is_primary: true }),
        ],
    });
    const result = processDiagnostic(diag, WS, "check");
    expect(result.spans[0].rank).toBe(0);
    expect(result.spans[1].rank).toBe(3);
});

test("processDiagnostic: handles error level", () => {
    const diag = makeDiag({ level: "error", message: "mismatched types" });
    const result = processDiagnostic(diag, WS, "check");
    expect(result.level).toBe("error");
});
