import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { getActiveBoard, getEffectivePort, selectBoard } from "./boardConfig";
import { getActiveFile } from "./filePicker";

export type FlashProgressEvent =
  | { type: "progress"; phase: "erasing" | "programming"; pct: number }
  | { type: "done"; success: boolean };

export type FlashProgressCallback = (event: FlashProgressEvent) => void;

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export function parseProgress(line: string): { phase: "erasing" | "programming"; pct: number } | null {
  const clean = stripAnsi(line);
  const m = clean.match(/(Erasing|Programming)\s+[✔✓ ]?\s*(\d+)%/i);
  if (!m) { return null; }
  return { phase: m[1].toLowerCase() as "erasing" | "programming", pct: parseInt(m[2], 10) };
}

let _flashChannel: vscode.OutputChannel | undefined;
function getChannel(): vscode.OutputChannel {
  if (!_flashChannel) { _flashChannel = vscode.window.createOutputChannel("Flash"); }
  return _flashChannel;
}

function spawnWithProgress(cmdLine: string, env: NodeJS.ProcessEnv, cb: FlashProgressCallback): void {
  const out = getChannel();
  out.clear();
  out.show(true);

  const proc = spawn(cmdLine, [], { shell: true, env });

  let buf = "";
  const handleChunk = (data: Buffer) => {
    const text = buf + data.toString();
    buf = "";
    // Split on newline or carriage return (probe-rs uses \r for live progress)
    const chunks = text.split(/[\n\r]+/);
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) { continue; }
      out.appendLine(stripAnsi(trimmed));
      const progress = parseProgress(trimmed);
      if (progress) { cb({ type: "progress", ...progress }); }
    }
  };

  proc.stdout.on("data", handleChunk);
  proc.stderr.on("data", handleChunk);

  proc.on("close", code => {
    if (buf.trim()) {
      out.appendLine(stripAnsi(buf.trim()));
      const progress = parseProgress(buf);
      if (progress) { cb({ type: "progress", ...progress }); }
    }
    cb({ type: "done", success: code === 0 });
  });
}

export async function flash(onProgress?: FlashProgressCallback): Promise<void> {
  const board = getActiveBoard() ?? (await selectBoard());
  if (!board) { return; }

  const port = getEffectivePort();
  const cb: FlashProgressCallback = onProgress ?? (() => { });

  if (board.run?.command) {
    spawnWithProgress(board.run.command, { ...process.env } as NodeJS.ProcessEnv, cb);
  } else if (board.new_project?.runner) {
    const probeEnv: NodeJS.ProcessEnv = port
      ? { ...process.env, PROBE_RS_PROBE: port }
      : { ...process.env } as NodeJS.ProcessEnv;
    const activeFile = getActiveFile();
    const binFlag = activeFile && path.basename(activeFile) !== "main.rs"
      ? ` --bin ${path.basename(activeFile, ".rs")}`
      : "";
    spawnWithProgress(`cargo run --release${binFlag}`, probeEnv, cb);
  } else if (board.probe) {
    const probePath = vscode.workspace.getConfiguration("rustdyno").get<string>("probersPath", "probe-rs");
    const portFlag = port ? ` --probe ${port}` : "";
    const cmd =
      `${probePath} run --chip ${board.board.chip}` +
      ` --protocol ${board.probe.protocol}` +
      ` --speed ${board.probe.speed}` +
      portFlag;
    spawnWithProgress(cmd, { ...process.env } as NodeJS.ProcessEnv, cb);
  } else {
    vscode.window.showErrorMessage("No flash command configured for this board. Add a [run] command or [probe] section to the board config.");
  }
}
