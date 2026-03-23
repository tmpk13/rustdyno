import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";

export interface CargoSpan {
    file_name: string;
    line_start: number;
    column_start: number;
    line_end: number;
    column_end: number;
    is_primary: boolean;
    label: string | null;
    text: { text: string; highlight_start: number; highlight_end: number }[];
}

export interface CargoDiagnostic {
    message: string;
    level: "error" | "warning" | "note" | "help" | "failure-note";
    spans: CargoSpan[];
    children: CargoDiagnostic[];
    rendered: string;
    code: { code: string; explanation?: string } | null;
}

export interface SortedSpan extends CargoSpan {
    rank: 0 | 1 | 2 | 3;
    abs_path: string;
}

export interface CheckDiagnostic {
    message: string;
    level: "error" | "warning" | "note" | "help" | "failure-note";
    code: string | null;
    rendered: string;
    spans: SortedSpan[];
    source: "check" | "clippy";
}

export interface CheckResult {
    diagnostics: CheckDiagnostic[];
    checkSuccess: boolean;
    clippySuccess: boolean;
    errorCount: number;
    warningCount: number;
}

let _checkChannel: vscode.OutputChannel | undefined;
function getChannel(): vscode.OutputChannel {
    if (!_checkChannel) { _checkChannel = vscode.window.createOutputChannel("Cargo Check"); }
    return _checkChannel;
}

export function rankSpan(span: CargoSpan, wsRoot: string): 0 | 1 | 2 | 3 {
    const f = span.file_name;
    const isRelative = !path.isAbsolute(f);
    if (isRelative) {
        if (f.startsWith("target/") || f.startsWith("target\\")) { return 3; }
        return span.is_primary ? 0 : 1;
    }
    const absF = f;
    if (absF.startsWith(path.join(wsRoot, "target"))) { return 3; }
    if (absF.includes("/.cargo/registry/") || absF.includes("/.cargo/git/") ||
        absF.includes("\\.cargo\\registry\\") || absF.includes("\\.cargo\\git\\")) { return 2; }
    return span.is_primary ? 0 : 1;
}

export function processSpans(spans: CargoSpan[], wsRoot: string): SortedSpan[] {
    const sorted = spans.map(span => {
        const rank = rankSpan(span, wsRoot);
        const abs_path = path.isAbsolute(span.file_name)
            ? span.file_name
            : path.join(wsRoot, span.file_name);
        return { ...span, rank, abs_path };
    });
    sorted.sort((a, b) => a.rank - b.rank);
    return sorted;
}

export function processDiagnostic(diag: CargoDiagnostic, wsRoot: string, source: "check" | "clippy"): CheckDiagnostic {
    return {
        message: diag.message,
        level: diag.level,
        code: diag.code?.code ?? null,
        rendered: diag.rendered ?? "",
        spans: processSpans(diag.spans, wsRoot),
        source,
    };
}

function runCargo(args: string, wsRoot: string, source: "check" | "clippy"): Promise<{ diagnostics: CheckDiagnostic[]; success: boolean }> {
    return new Promise(resolve => {
        const env: NodeJS.ProcessEnv = { ...process.env, CARGO_TERM_COLOR: "never" };
        const cmd = `cargo ${args} --message-format=json --color=never`;
        const out = getChannel();

        const proc = spawn(cmd, [], { shell: true, cwd: wsRoot, env });
        const diagnostics: CheckDiagnostic[] = [];
        let buf = "";

        const handleChunk = (data: Buffer) => {
            const text = buf + data.toString();
            buf = "";
            const lines = text.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) { continue; }
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.reason === "compiler-message" && parsed.message) {
                        const diag = parsed.message as CargoDiagnostic;
                        // Skip top-level "aborting due to" and empty-span notes
                        if (diag.level === "failure-note" || diag.spans.length === 0) { continue; }
                        diagnostics.push(processDiagnostic(diag, wsRoot, source));
                    }
                } catch {
                    // Non-JSON line (cargo itself erroring, build scripts, etc.) — log to channel
                    out.appendLine(trimmed);
                }
            }
        };

        proc.stdout.on("data", handleChunk);
        proc.stderr.on("data", (data: Buffer) => {
            out.appendLine(data.toString().trim());
        });

        proc.on("close", code => {
            if (buf.trim()) {
                try {
                    const parsed = JSON.parse(buf.trim());
                    if (parsed.reason === "compiler-message" && parsed.message) {
                        const diag = parsed.message as CargoDiagnostic;
                        if (diag.level !== "failure-note" && diag.spans.length > 0) {
                            diagnostics.push(processDiagnostic(diag, wsRoot, source));
                        }
                    }
                } catch { /* ignore */ }
            }
            resolve({ diagnostics, success: code === 0 });
        });
    });
}

export async function runCheckAndClippy(wsRoot: string): Promise<CheckResult> {
    const out = getChannel();
    out.clear();

    out.appendLine("Running cargo check...");
    const checkResult = await runCargo("check", wsRoot, "check");
    const checkSuccess = checkResult.success;
    const allDiagnostics: CheckDiagnostic[] = [...checkResult.diagnostics];

    let clippySuccess = false;
    if (checkSuccess) {
        out.appendLine("Running cargo clippy...");
        const clippyResult = await runCargo("clippy", wsRoot, "clippy");
        clippySuccess = clippyResult.success;

        // Deduplicate: skip clippy diagnostics already emitted by check
        const checkKeys = new Set(
            checkResult.diagnostics.map(d => `${d.message}|${d.spans[0]?.file_name ?? ""}|${d.spans[0]?.line_start ?? 0}`)
        );
        for (const d of clippyResult.diagnostics) {
            const key = `${d.message}|${d.spans[0]?.file_name ?? ""}|${d.spans[0]?.line_start ?? 0}`;
            if (!checkKeys.has(key)) {
                allDiagnostics.push(d);
            }
        }
    }

    const errorCount = allDiagnostics.filter(d => d.level === "error").length;
    const warningCount = allDiagnostics.filter(d => d.level === "warning").length;

    out.appendLine(`Done. ${errorCount} error(s), ${warningCount} warning(s).`);

    return { diagnostics: allDiagnostics, checkSuccess, clippySuccess, errorCount, warningCount };
}
