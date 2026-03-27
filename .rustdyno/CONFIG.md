# rdyno Board Config Reference

Board configs live in `.rustdyno/*.toml` (one file per board). The workspace
state file `rustdyno.toml` is also in this folder but is managed automatically.

---

tabs_vertical = true              # default: true (set false for horizontal tabs)
tabs_auto_collapse_seconds = 5    # default: 5 (set 0 to disable auto-collapse)


## `[board]`

Core identity of the target chip and Rust compile target.

| Key      | Type   | Required | Description                                       |
|----------|--------|----------|---------------------------------------------------|
| `name`   | string | yes      | Human-readable label shown in the UI              |
| `chip`   | string | yes      | probe-rs chip identifier (e.g. `STM32F411CEUx`)   |
| `target` | string | yes      | Rust target triple (e.g. `thumbv7em-none-eabihf`) |

```toml
[board]
name   = "STM32F411 BlackPill"
chip   = "STM32F411CEUx"
target = "thumbv7em-none-eabihf"
```

---

## `[probe]`

Debug probe connection settings passed to probe-rs.

| Key        | Type    | Required | Description                                    |
|------------|---------|----------|------------------------------------------------|
| `protocol` | string  | yes      | `"Swd"` or `"jtag"`                           |
| `speed`    | integer | yes      | Clock speed in kHz                             |
| `port`     | string  | no       | Serial port override (e.g. `/dev/ttyUSB0`)    |

```toml
[probe]
protocol = "Swd"
speed    = 4000   # kHz
# port   = "/dev/ttyUSB0"   # optional override
```

---

## `[flash]`

Extra flags forwarded to `probe-rs flash`. All keys are optional and
board-specific. Omit the section entirely if no overrides are needed.

```toml
[flash]
restore_unwritten = false
halt_afterwards   = false
```

---

## `[rtt]`

RTT (Real-Time Transfer) monitor settings.

| Key        | Type    | Required | Description                      |
|------------|---------|----------|----------------------------------|
| `enabled`  | bool    | yes      | Enable RTT output in the panel   |
| `channels` | array   | no       | List of RTT channel descriptors  |

Each channel has:

| Key    | Type    | Description              |
|--------|---------|--------------------------|
| `up`   | integer | RTT up-channel index     |
| `name` | string  | Display name in the UI   |

Two equivalent syntaxes are accepted:

```toml
# inline array
[rtt]
enabled  = true
channels = [{ up = 0, name = "Terminal" }]
```

```toml
# array-of-tables
[rtt]
enabled = true

[[rtt.channels]]
up   = 0
name = "Terminal"
```

---

## `[tool]` *(optional)*

Declares the CLI tool required to flash or monitor the board. When present and
the tool is **not detected**, the panel shows an install button above the
*Edit layout* footer. Pressing the button once expands it to a **Confirm**
state; pressing again runs the platform-specific install command.

| Key               | Type   | Required | Description                                            |
|-------------------|--------|----------|--------------------------------------------------------|
| `name`            | string | yes      | CLI tool name shown in the UI (e.g. `"probe-rs"`)     |
| `check`           | string | no       | Command used to detect the tool (default: `<name> --version`) |
| `success_message` | string | no       | Message shown after successful install (e.g. restart notice)  |

### `[tool.install]` *(optional)*

Per-platform install commands. Only the platforms you provide will be offered.

| Key     | Type   | Description                 |
|---------|--------|-----------------------------|
| `linux` | string | Install command for Linux   |
| `mac`   | string | Install command for macOS   |
| `win`   | string | Install command for Windows |

```toml
[tool]
name  = "probe-rs"
check = "probe-rs --version"
success_message = "Restart your terminal for changes to take effect"

[tool.install]
linux = "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/probe-rs/probe-rs/releases/latest/download/probe-rs-tools-installer.sh | sh"
mac   = "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/probe-rs/probe-rs/releases/latest/download/probe-rs-tools-installer.sh | sh"
win   = "powershell -ExecutionPolicy ByPass -c \"irm https://github.com/probe-rs/probe-rs/releases/latest/download/probe-rs-tools-installer.ps1 | iex\""
```

```toml
[tool]
name = "espflash"

[tool.install]
linux = "cargo install espflash"
mac   = "cargo install espflash"
win   = "cargo install espflash"
```

---

## `[run]` *(optional)*

Override the default `probe-rs run` command with a custom shell command.
Useful for bootloader-based flashing workflows.

| Key       | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `command` | string | Shell command run instead of probe-rs    |

```toml
[run]
command = "espflash flash --monitor target/riscv32imc-unknown-none-elf/release/my-app"
```

---

## `[new_project]` *(optional)*

Defines the files and Cargo settings to scaffold when generating a new
project from this board config. All keys are optional.

| Key            | Type              | Description                                           |
|----------------|-------------------|-------------------------------------------------------|
| `runner`       | string            | `runner` line written into `.cargo/config.toml`       |
| `dependencies` | inline table      | Crate dependencies added to `Cargo.toml`              |
| `files`        | array of tables   | Files to create; each has a `path` and `content`      |

### `[[new_project.files]]`

| Key       | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| `path`    | string | Relative path from the project root              |
| `content` | string | Full text content of the file (multiline strings supported) |

File content supports template variables that are substituted at project creation time:

| Variable          | Replaced with                                          |
|-------------------|--------------------------------------------------------|
| `{{PROTOCOL}}`    | The probe protocol from `[probe] protocol`             |
| `{{BOARD_FILE}}`  | The board config filename (e.g. `microbit-v2.toml`)    |

Use `{{BOARD_FILE}}` in a generated `rustdyno.toml` to pre-select the correct board:

```toml
[[new_project.files]]
path    = "rustdyno.toml"
content = """
default="{{BOARD_FILE}}"
"""
```

Or hardcode the filename directly if the board config name is stable:

```toml
[[new_project.files]]
path    = "rustdyno.toml"
content = """
default="my-board.toml"
"""
```

### `[[new_project.generate]]` *(optional)*

One or more shell commands to generate a new project via an external tool
(e.g. `cargo generate`, `esp-generate`). When a board defines these, a
**Generate Project** section appears in the New Project tab with a project
name field, a location picker, and a button that runs the command in a
terminal.

If multiple entries are defined a dropdown appears first to select which
template to use.

| Key       | Type   | Description                                              |
|-----------|--------|----------------------------------------------------------|
| `label`   | string | Display name shown in the dropdown                       |
| `command` | string | Shell command to run; supports `{{PROJECT_NAME}}`        |

`{{PROJECT_NAME}}` is replaced with the value typed into the Project Name
field before the command is sent to the terminal.

**Single command** — use a plain string on `generate`:

```toml
[new_project]
generate = "cargo generate esp-rs/esp-idf-template cargo --name {{PROJECT_NAME}}"
```

**Multiple commands** — use array-of-tables:

```toml
[[new_project.generate]]
label   = "cargo generate (esp-idf-template)"
command = "cargo generate esp-rs/esp-idf-template cargo --name {{PROJECT_NAME}}"

[[new_project.generate]]
label   = "esp-generate"
command = "esp-generate --chip esp32c3 -o stack-smashing-protection -o esp-backtrace -o vscode {{PROJECT_NAME}}"
```

A board can have both `[[new_project.files]]` scaffolding and
`[[new_project.generate]]` commands — both sections will be shown in the
New Project tab.

---

### Example

```toml
[new_project]
runner = "probe-rs run --chip STM32F411CEUx"

[new_project.dependencies]
"cortex-m"    = { version = "0.7", features = ["critical-section-single-core"] }
"cortex-m-rt" = "0.7"
"rtt-target"  = "0.5"

[[new_project.files]]
path    = "src/main.rs"
content = """
#![no_std]
#![no_main]

use cortex_m_rt::entry;

#[entry]
fn main() -> ! {
    loop {}
}
"""

[[new_project.files]]
path    = ".cargo/config.toml"
content = """
[target.thumbv7em-none-eabihf]
runner = "probe-rs run --chip STM32F411CEUx"

[build]
target = "thumbv7em-none-eabihf"
"""
```

---

## `rustdyno.toml` (workspace state)

Managed automatically by the extension. The `default` key is written by
`[[new_project.files]]` at project creation and can also be edited by hand
to change the active board.

| Key       | Type             | Description                                      |
|-----------|------------------|--------------------------------------------------|
| `default` | string           | Filename of the board selected by default        |
| `target`  | string           | Relative path of the active file in the picker   |
| `hidden`  | array of strings | Files hidden in the file picker                  |
| `order`   | array of strings | Custom ordering of files in the file picker      |

```toml
default = "stm32f1.toml"
target  = "src/main.rs"
hidden  = ["scratch.rs"]
order   = ["main.rs", "lib.rs"]
```
