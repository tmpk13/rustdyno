# rustdyno

<img width="200rem" alt="Rust crab and dynosaur" src="imgs/dyno.png">  

Rust running for embedded projects from VSCode

github.com/tmpk13/rustdyno


## Run
<<<<<<< HEAD
Install: `bun install`
Compile: `bun run compile`
Build extension: `bunx vsce package`
Tests: `bun run test:unit`
=======
Compile: `bun run compile`  
Build extension: `bunx vsce package`  
Tests: `bun run test:unit`  
>>>>>>> main

<hr>

## Required CLI Tools

Install the tools for the boards you intend to use.

| Tool | Used by | Install |
|---|---|---|
| [probe-rs](https://probe.rs/) | STM32, nRF, RP2040/RP2350, micro:bit (all SWD boards) | `cargo install probe-rs-tools` |
| [espflash](https://github.com/esp-rs/espflash) | ESP32-C3 | `cargo install espflash` |
| [ravedude](https://github.com/Rahix/avr-hal/tree/main/ravedude) | Arduino Nano (ATmega328P) | `cargo install ravedude` |
| [teensy_loader_cli](https://github.com/PaulStoffregen/teensy_loader_cli) | Teensy 2, 3.2, 4.0, 4.1 | package manager or build from source |
| `arm-none-eabi-objcopy` | Teensy 3.2, 4.0, 4.1 (ELF → HEX) | `apt install gcc-arm-none-eabi` / `brew install arm-none-eabi-binutils` |
| `avr-objcopy` | Teensy 2.0 (ELF → HEX) | `apt install binutils-avr` / `brew install avr-binutils` |

<hr>

## Features
 - Automatic port recognition
 - Board configuration with toml
 - Create new projects
 - Download board configurations from remote repo

<img src="imgs/pannel-screenshot-1.png" height="400rem">
<img src="imgs/pannel-screenshot-2.png" height="400rem">
<img src="imgs/pannel-screenshot-3.png" height="400rem">

<hr>
<br>


<hr>
<br>

Inspired by: https://fob4.po8.org/posts/0050-rustdyno.html


Claude Code was used in the development process
