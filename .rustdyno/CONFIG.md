# rdyno Board Config Reference

Board configs live in `.rustdyno/*.toml` (one file per board). The workspace
state file `rustdyno.toml` is also in this folder but is managed automatically.

---

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
