<!-- for grabbing new checks
- [ ] 
 -->

- [ ] Add port selection
- [ ] Bind loading on panel buttons to something
- [x] Add run commands option for toml
- [x] Make the layout not wobble on hover
- [x] Make default board get selected
- [x] Rotate the dropdown icon
- [ ] Add SVG icons
    - [x] Dropdown
    - [x] Run
    - [ ] Stop
    - [ ] Debug
- [x] Add one menu for selecting config options
- [x] have config options in toml
- [x] Add Port name overflow handling
- [x] Port should be saved as default in the .boards file
- [x] Make .boards folder a different name, and picker.toml
- [ ] Toggle button for run button in status bar
- [x] Poll serial device state to see if still connected, while not doing a command
- [x] On hover for 2 sec show the command for build/flash
- [x] Generate new projects
- [x] Add ability to name devices
- [x] Generate a `.rustdyno` file if it does not exist
- [x] Have git repo for list of configs
- [ ] Have folders for boards, split up the toml files
- [ ] Add git files automatically, set rules
- [ ] Add STOP feature probe-rs `probe-rs reset --halt`?
- [x] Make static reload button rotate
- [x] Trigram + Jaro-Winkler fuzzy search for the boards
- [ ] Make it flip orientation when it is wider than it is high
- [ ] Board adder tool page with checkboxes to enable/disable the items. Typing in the edit field enables it 
- [ ] Add clear button for searching boards 
- [ ] Add remove all local button
- [ ] Add setting for disable remote repo
- [ ] Separate the html from the js 

- [ ] Button that asks to install probe-rs if the user doesn't have it
    - [ ] `probe-rs complete install` on linux 
    - [ ] Read `bin` file from `Cargo.toml`
    - [ ] rust-toolchain.toml

- [x] Toggle button that turns on edit mode where every element can be toggled and rearranged
    - [x] Only in main panel
    - [x] Turn off UI function of elements during this
    - [x] Adjustments stored in toml

- [ ] Split up toml configs
- [ ] When no target is selected auto select main.rs as target. Have new target saved on swapping
- [ ] Use flex layout for better responsiveness

- [x] Refresh is a square when loading in boards fix this
    - [x] When closing / opening the board panel the images disappear
    - [x] When closing / opening the new project the board gets unloaded
    - [x] New project section tab should have its own board selection with search

- [ ] Edit mode
    - [ ] Make drag bar thicker
    - [ ] Make reset button
- [ ] Animate check mark
- [x] Upload progress bar from probe-rs output
- [x] Reverse the hidden state

- [x] move edit to bottom add label

- [x] Fix hidden items count
- [x] Make hidden items button not low opacity by default

- [x] Separate icons/bg color for each action
- [x] Have options in board toml for new actions, have actions set in toml

- [ ] Add examples section
- [ ] Swapping tabs removes UI elements from the board controls tab
- [ ] Button for install probe-rs or command based on platform for user to run

- [ ] Don't use swd by default on esp check others
- [x] poll for serial when auto is the port selection show the board that will be used name

- [ ] Verify the configs for new project are being used
- [ ] Remove board/ from boards

- [ ] Don't use vscode tabs unless they can be made larger

- [ ] sdk defaults needs to be generated
- [ ] Add dividers

- [x] Name boards by serial id
- [ ] Outline on focus outer outline that is thicker and transparent/lighter

- [ ] Toggle formatting options in .cargo/config.toml
    - [ ] [env]
    - [ ] DEFMT_LOG = "trace"

- [ ] Live loading bar on run button
    - [ ] Erasing ✔ 100% [####################]  17.00 KiB @  22.56 KiB/s (took 1s)
    - [ ] Programming ✔ 100% [####################]  17.00 KiB @  17.86 KiB/s (took 1s)
    - [ ] Show check on finish

- [ ] If no .rustdyno does not exist have new project show up for current or new dir

- [x] Add pulse to the status
- [ ] Fix status pulse to center it

- [ ] Support multiple board targets in one upload loop through

- [ ] File checker button
- [ ] Make it so that naming the new project is from a text input not popup

- [ ] Add a way to update existing project with new files from the board library
- [ ] Add support for cargo generate

- [x] Fix rtt attach

- [ ] Esp is selected board even when selecting others in the new project section fix

- [x] Make cache only used if no internet
    - [ ] add toggle button to use cache or not
    - [ ] make so directory can be used as remote repo
    - [ ] make so cache dir can be set to draw from

- [x] Add border on hover

- [ ] Collapse boards with the same source directory in board library

- [ ] Fix rtt detection (probe section required? esp32c3 uses espflash?)

- [x] Tests for file creation
- [x] Tests for command output
- [ ] Review tests add documentation for them

# ?
- [ ] integrate installer for board toolchains??
