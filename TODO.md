<!-- for grabbing new checks
- [ ] 
 -->

- [x] Add port selection
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

- [x] Fix rtt detection (probe section required? esp32c3 uses espflash?)

- [x] Tests for file creation
- [x] Tests for command output
- [ ] Review tests add documentation for the tests


- [ ] Board maker - toml generator GUI
    - [x] List required fields
    - [x] Dropdown with list options for overall
    - [ ] Dropdown with list options for field (with options) 
    - [x] Arrow keys navigate the input boxes
    - [x] Hitting enter either
        - a. Moves the cursor to an input to the right in the current field 
        - b. Moves the cursor to the next line if no more inputs on row 
        - c. creates a new field in the current section (ex. pins, create new pin alias)
?    - [ ] Pull from current toml options
    - [ ] Have defaults for some items (like baud) but warn user if they try to submit, if they try again immediately just use defaults in the toml

- [ ] Add regex assignment
- [ ] Auto baud detection

- [ ] Add tool install check and install button, ex espflash/toolchain

- [ ] Make it so error messages can be copied

- [ ] Make checkbox for the 

- [ ] Swap to using flex UI

- [ ] Be able to copy layout from other projects

- [ ] swap to vertical tabs when too thin

- [ ] Add ability to set panel color and add title for window identification.

- [ ] Add tooltip for `...` tab

- [ ] Add esp32s3 board 

- [ ] Short names get arbitrary numbers at end of names

- [x] Remove split main
- [x] Remove drop-icon buttons in the action buttons

- [ ] Attempt to auto detect board and ask to use/download (non intrusive (Don't focus))
        from the long/short name - use closest as default if not set in rustdyno

- [ ] Add esp-generate support

- [?] Add append if exists flag for file generation. Sections may be marked append
 - [x] Swap dependencies to a string
 -  ```
    append_if_exists = false
    content = """
    [new_project]
    runner = "probe-rs run --chip STM32F103C8Tx --protocol swd"
    """
    append_if_exists = true
    content = """
    [new_project.dependencies]
    cortex-m     = { version = "0.7.7", features = ["critical-section-single-core"] }
    cortex-m-rt  = "0.7.5"
    nb           = "1.1"
    panic-halt   = "1.0"
    rtt-target   = "0.6"
    stm32f1xx-hal = { version = "0.11", features = ["stm32f103", "rt"] }
    """
    ```

- Add animations
 - [ ] Tooltips expand left to right, snap out

- [ ] Add repo list UI for adding repos
        Clickable list. Double click or click edit icon to edit.
        Seperate boxes for name/url
        ```
         ____________________________________
        |Name|URL                            |
        |main | repo|github.com/tmpk13/boards|
        |                                    |
        |                                    |
         ------------------------------------
        |[+]|[-]|
        ```

- [x] Add tests for project creation
 - [x] Test with existing and new projects
 - [x] Make sure backups for overwritten files are correct

- [x] Make tooltips in html more concise to fit better, Don't touch command previews that expand on long hover

- [x] Add hex input for custom panel color

- [ ] Make color choices evenly wrap, last two currently only ones on next line should be even rows
- [ ] Add optional config in .rustdyno for default colors 

- [ ] If can add button in .rustdyno/rustdyno.toml file to save as global rustdyno file. Or replace current with global. Also add replace rustdyno.toml button with global rustdyno.toml in pannel. Add backup in .rustdyno/ if replacing existing.

- [ ] Add many animated checks

- [x] Fix input border on hover/click moving other elements (outline?)
- [x] Remove the `boards/` prefix from the library


# ?
- [ ] integrate installer for board toolchains??

