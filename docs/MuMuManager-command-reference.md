# MuMuManager command reference

Captured live from `C:\Program Files\Netease\MuMuPlayer\nx_main\MuMuManager.exe` — manager version `6.8.2.0`.

Eighteen top-level subcommands, 35 entries including nested ones. Regenerate after a MuMu upgrade with:

```
node tools/build-command-reference.js "<MuMu root>"
```

## Index

| Subcommand | Summary | Nested |
|---|---|---|
| `version` | Get player version. | — |
| `info` | Get players info. | — |
| `create` | Create players. | — |
| `clone` | Clone players. (alias: copy) | — |
| `upgrade` | Upgrade player Android version. | — |
| `delete` | Delete players. | — |
| `rename` | Rename players. | — |
| `import` | Import .mumudata files. | — |
| `export` | Export players as .mumudata files. | — |
| `control` | Control players. | `launch`, `shutdown`, `restart`, `show_window`, `hide_window`, `layout_window`, `app`, `tool`, `shortcut` |
| `setting` | Config players. | — |
| `adb` | Run adb cmd for players. | — |
| `simulation` | Change simulated properties in players. | — |
| `sort` | Layout player windows to sort. | — |
| `driver` | Manage player drivers. | `install`, `uninstall` |
| `log` | Control manager log. | `on`, `off` |
| `sh` | Run player shell. | — |
| `main` | Control main application. | `launch`, `close`, `kill`, `engine` |

## `MuMuManager version`

Get player version.

```
OVERVIEW: Get player version.

USAGE: version

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager info`

Get players info.

```
OVERVIEW: Get players info.

USAGE: info [--vmindex <vmindex>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager create`

Create players.

```
OVERVIEW: Create players.

USAGE: create [--vmindex <vmindex>] [--number <number>] [--mini] [--version <android_version>]

OPTIONS:
  -h, --help                         Show help information.
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all

  -n, --number <number>              Number of action run.
  -m, --mini                         Set mini disk mode for data disk.
  -ver, --version <android_version>  Android engine version: auto, 12, or 15.
```

## `MuMuManager clone`

Clone players. (alias: copy)

```
OVERVIEW: Clone players. (alias: copy)

USAGE: clone [--vmindex <vmindex>] [--number <number>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -n, --number <number>              Number of action run.
```

## `MuMuManager upgrade`

Upgrade player Android version.

```
OVERVIEW: Upgrade player Android version.

USAGE: upgrade [--vmindex <vmindex>] [--android_version <android_version>] [--status] [--cancel] [--no-keep]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  --android_version <android_version>Target Android engine version.
  --status                           Get Android upgrade progress and state.
  --cancel                           Cancel Android upgrade engine download.
  --no-keep                          Replace source player without keeping data.
```

## `MuMuManager delete`

Delete players.

```
OVERVIEW: Delete players.

USAGE: delete [--vmindex <vmindex>] [--version <android_version>] [--no_wait]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -ver, --version <android_version>  Android engine version: auto, 12, or 15.
  --no_wait                          Do not wait for player deletion to finish.
```

## `MuMuManager rename`

Rename players.

```
OVERVIEW: Rename players.

USAGE: rename [--vmindex <vmindex>] [--name <name>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all

  -n, --name <name>                  Player name.

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager import`

Import .mumudata files.

```
OVERVIEW: Import .mumudata files.

USAGE: import [--path <path>] [--number <number>] [--version <android_version>]

ARGUMENTS:
  -p, --path <path>                  The .mumudata file path. ((one/more)) 

OPTIONS:
  -h, --help                         Show help information.
  -n, --number <number>              Number of action run.
  -ver, --version <android_version>  Android engine version: auto, 12, or 15.
```

## `MuMuManager export`

Export players as .mumudata files.

```
OVERVIEW: Export players as .mumudata files.

USAGE: export [--vmindex <vmindex>] [--dir <dir>] [--name <name>] [--zip] [--version <android_version>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all

  -d, --dir <dir>                    The .mumudata file directory.

OPTIONS:
  -h, --help                         Show help information.
  -n, --name <name>                  The .mumudata file name.
  -z, --zip                          Use compressed file format.
  -ver, --version <android_version>  Android engine version: auto, 12, or 15.
```

## `MuMuManager control`

Control players.

```
OVERVIEW: Control players.

USAGE: control [--vmindex <vmindex>] [--version <android_version>] <subcommand>

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -ver, --version <android_version>  Android engine version: auto, 12, or 15.

SUBCOMMANDS:
  launch                             Launch players.
  shutdown                           Shutdown players.
  restart                            Restart players.
  show_window                        Show player windows.
  hide_window                        Hide player windows.
  layout_window                      Layout player windows position and size.
  app                                Control app in players.
  tool                               Control toolbar in players.
  shortcut                           Control shortcut in players.
```

## `MuMuManager control launch`

Launch players.

```
OVERVIEW: Launch players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} launch [--package <package>]

OPTIONS:
  -h, --help                         Show help information.
  -pkg, --package <package>          App package bundle id.
```

## `MuMuManager control shutdown`

Shutdown players.

```
OVERVIEW: Shutdown players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} shutdown

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager control restart`

Restart players.

```
OVERVIEW: Restart players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} restart

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager control show_window`

Show player windows.

```
OVERVIEW: Show player windows.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} show_window

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager control hide_window`

Hide player windows.

```
OVERVIEW: Hide player windows.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} hide_window

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager control layout_window`

Layout player windows position and size.

```
OVERVIEW: Layout player windows position and size.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} layout_window [--pos_x <pos_x>] [--pos_y <pos_y>] [--size_w <size_w>] [--size_h <size_h>]

OPTIONS:
  -h, --help                         Show help information.
  -px, --pos_x <pos_x>               The X-axis of window position, screen left is zero.
  -py, --pos_y <pos_y>               The Y-axis of window position, screen top is zero.
  -sw, --size_w <size_w>             Width of window size.
  -sh, --size_h <size_h>             Height of window size.
```

## `MuMuManager control app`

Control app in players.

```
OVERVIEW: Control app in players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} app <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  install                            Install app in players.
  uninstall                          Uninstall app in players.
  launch                             Launch app in players.
  close                              Close app in players.
  info                               Get app info in players.
```

## `MuMuManager control tool`

Control toolbar in players.

```
OVERVIEW: Control toolbar in players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} tool <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  func                               Trigger toolbar function in players.
  cmd                                Run toolbar cmd in players.
  downcpu                            Set CPU execute cap in players.
  location                           Update location in players.
  gyro                               Change gravity sensing in players.
```

## `MuMuManager control shortcut`

Control shortcut in players.

```
OVERVIEW: Control shortcut in players.

USAGE: {control [--vmindex <vmindex>] [--version <android_version>]} shortcut <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  create                             Create shortcut in desktop for players.
  delete                             Delete shortcut in desktop for players.
```

## `MuMuManager setting`

Config players.

```
OVERVIEW: Config players.

USAGE: setting [--vmindex <vmindex>] [--key <key>] [--value <value>] [--all] [--all_writable] [--info] [--path <path>]

OPTIONS:
  -h, --help                         Show help information.
  -v, --vmindex <vmindex>            The index of target player. (If not specified, global setting will be set.)

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all

  -k, --key <key>                    Key of player setting. ((one/more)) 

    Discussion:
    1. Select a key for player setting: 
        --key key
    2. Select multi keys for player setting: 
        --key key1 --key key2 --key key3 ...

  -val, --value <value>              Value of player setting key. ((one/more)) 

    Discussion:
    1. Set a value for a setting key: 
        --key key --value value
    2. Set a empty value for a setting key: 
        --key key --value __null__
    3. Set multi values for multi setting keys: 
        --key key1 --value value1 --key key2 --value value2 ...

  -a, --all                          All keys of player setting.
  -aw, --all_writable                All writable keys of player setting.
  -i, --info                         Show info for player setting key.
  -p, --path <path>                  The .json file path (UTF-8) to change player setting.

    Discussion:
    1. Change player setting for a .json file: 
        --path path\file.json
    2. If use path param, key-value params will not take effect: 
        --key key --value value --path path\file.json
```

## `MuMuManager adb`

Run adb cmd for players.

```
OVERVIEW: Run adb cmd for players.

USAGE: adb [--vmindex <vmindex>] [--cmd <cmd>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -c, --cmd <cmd>                    Command line arguments.

    Discussion:
    1. connect: Connect adb to player. 
        == adb connect <host>:<ip>
    2. disconnect: Disconnect adb to player. 
        == adb disconnect <host>:<ip>
    3. "getprop ro.opengles.version": Get android system props in player. 
        == adb -s <host>:<ip> shell getprop ro.opengles.version
    4. "setprop ro.opengles.version xxx": Set android system props in player. 
        == adb -s <host>:<ip> shell setprop ro.opengles.version xxx
    5. "input_text xxx": Input text to player.
        == adb -s <host>:<ip> shell input text xxx
    6. Input keyevent to player:
        go_back == adb -s <host>:<ip> shell input keyevent 4
        go_home == adb -s <host>:<ip> shell input keyevent 3
        go_task == adb -s <host>:<ip> shell input keyevent 187
        key_delete == adb -s <host>:<ip> shell input keyevent 67
        key_enter == adb -s <host>:<ip> shell input keyevent 66
        key_space == adb -s <host>:<ip> shell input keyevent 62
        volume_up == adb -s <host>:<ip> shell input keyevent 25
        volume_down == adb -s <host>:<ip> shell input keyevent 24
        volume_mute == adb -s <host>:<ip> shell input keyevent 164
```

## `MuMuManager simulation`

Change simulated properties in players.

```
OVERVIEW: Change simulated properties in players.

USAGE: simulation [--vmindex <vmindex>] [--simu_key <simu_key>] [--simu_value <simu_value>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -sk, --simu_key <simu_key>         Key of simulated properties.

    Discussion:
    1. android_id: Simulate Android ID properties.
    2. mac_address: Simulate MAC properties.
    3. imei: Simulate IMEI properties.

  -sv, --simu_value <simu_value>     Value of simulated properties.

    Discussion:
    1. __null__: set value to empty
```

## `MuMuManager sort`

Layout player windows to sort.

```
OVERVIEW: Layout player windows to sort.

USAGE: sort

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager driver`

Manage player drivers.

```
OVERVIEW: Manage player drivers.

USAGE: driver <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  install                            Install driver for players.
  uninstall                          Uninstall driver for players.
```

## `MuMuManager driver install`

Install driver for players.

```
OVERVIEW: Install driver for players.

USAGE: {driver} install [--name <name>]

ARGUMENTS:
  -n, --name <name>                  Driver name. (values: lwf)

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager driver uninstall`

Uninstall driver for players.

```
OVERVIEW: Uninstall driver for players.

USAGE: {driver} uninstall [--name <name>]

ARGUMENTS:
  -n, --name <name>                  Driver name. (values: lwf)

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager log`

Control manager log.

```
OVERVIEW: Control manager log.

USAGE: log <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  on                                 Log on for manager.
  off                                Log off for manager.
```

## `MuMuManager log on`

Log on for manager.

```
OVERVIEW: Log on for manager.

USAGE: {log} on

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager log off`

Log off for manager.

```
OVERVIEW: Log off for manager.

USAGE: {log} off

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager sh`

Run player shell.

```
OVERVIEW: Run player shell.

USAGE: sh [--vmindex <vmindex>] [--cmd <cmd>]

ARGUMENTS:
  -v, --vmindex <vmindex>            The index of target player.

    Discussion:
    1. Select a index of player:
        --vmindex 1
    2. Select multiple indexs of players:
        --vmindex 3,5,6,7
    3. Select all indexs of players:
        --vmindex all


OPTIONS:
  -h, --help                         Show help information.
  -c, --cmd <cmd>                    cmd of player shell.

    Discussion:
    1. --cmd "getprop ro.opengles.version": Get android system props in player. 
        == adb -s <host>:<ip> shell getprop ro.opengles.version
    2. --cmd "setprop ro.opengles.version xxx": Set android system props in player. 
        == adb -s <host>:<ip> shell setprop ro.opengles.version xxx
    3. --cmd "input_text xxx": Input text to player.
        == adb -s <host>:<ip> shell input text xxx
    4. --cmd <keyevent>: Input keyevent to player, keyevent like:
        go_back == adb -s <host>:<ip> shell input keyevent 4
        go_home == adb -s <host>:<ip> shell input keyevent 3
        go_task == adb -s <host>:<ip> shell input keyevent 187
        key_delete == adb -s <host>:<ip> shell input keyevent 67
        key_enter == adb -s <host>:<ip> shell input keyevent 66
        key_space == adb -s <host>:<ip> shell input keyevent 62
        volume_up == adb -s <host>:<ip> shell input keyevent 25
        volume_down == adb -s <host>:<ip> shell input keyevent 24
        volume_mute == adb -s <host>:<ip> shell input keyevent 164
```

## `MuMuManager main`

Control main application.

```
OVERVIEW: Control main application.

USAGE: main <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  launch                             Launch main application.
  close                              Close main application.
  kill                               Kill main application.
  engine                             Control Android engine.
```

## `MuMuManager main launch`

Launch main application.

```
OVERVIEW: Launch main application.

USAGE: {main} launch [--params <params>] [--admin]

OPTIONS:
  -h, --help                         Show help information.
  -p, --params <params>              Params for main launch.
  --admin                            Launch main as admin.
```

## `MuMuManager main close`

Close main application.

```
OVERVIEW: Close main application.

USAGE: {main} close

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager main kill`

Kill main application.

```
OVERVIEW: Kill main application.

USAGE: {main} kill

OPTIONS:
  -h, --help                         Show help information.
```

## `MuMuManager main engine`

Control Android engine.

```
OVERVIEW: Control Android engine.

USAGE: {main} engine <subcommand>

OPTIONS:
  -h, --help                         Show help information.

SUBCOMMANDS:
  install                            Install Android engine.
  cancel                             Cancel Android engine install download.
  state                              Get Android engine state.
```
