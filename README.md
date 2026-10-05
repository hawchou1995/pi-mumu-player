# MuMu Player Toolkit

A PI-Desktop plugin for the MuMu Android emulator. It finds the installation,
drives the whole `MuMuManager` command surface, and keeps the `winhttp` proxy's
VIP patch table aligned with the build that is actually installed.

## What it does

**Finds the emulator.** Four sources are tried in order, and the panel always
says which one won:

| Order | Source | How |
|---|---|---|
| 1 | `manual` | the absolute root saved in plugin settings |
| 2 | `process` | the path of a running `MuMuNxMain` / `MuMuNxService` / `MuMuNxDevice` process |
| 3 | `registry` | the `InstallLocation` of the MuMu entry under the Windows uninstall keys |
| 4 | `common-path` | the usual `Netease\MuMuPlayer` locations plus a shallow scan of the vendor folders |

A root is any folder holding `nx_main\MuMuManager.exe`. You may paste the root,
the `nx_main` folder, or the executable itself. A rejected manual path reports
why and leaves the previously working root in place.

**Drives the whole command surface.** All eighteen top-level subcommands and
their nested ones. `mumu_manager` passes arguments through unchanged; a call
with an unknown subcommand returns MuMuManager's own error text rather than
swallowing it.

```
version  info  create  clone  upgrade  delete  rename  import  export
control  setting  adb  simulation  sort  driver  log  sh  main
```

`control` alone has nine nested entries (`launch`, `shutdown`, `restart`,
`show_window`, `hide_window`, `layout_window`, `app`, `tool`, `shortcut`).
The captured help text ships in `data/mumu-commands.json`; the readable form is
`docs/MuMuManager-command-reference.md`.

**Keeps the VIP patch table in sync.** Two tables do the work.

The *file patch table* holds nine equal-length corrections inside
`nx_main\winhttp.dll`. A proxy built for an earlier MuMu build carries an `orig`
table whose call displacements no longer match, so its points are skipped at
runtime; the corrections retarget them. Each entry is verified against the file
before anything is written, and the original bytes must be unique in the file.

The *runtime point table* holds fifty-two points the proxy applies in memory,
thirty for `MuMuNxMain.exe`, eighteen for `MuMuNxService.exe` and four for
`MuMuRemoteService.exe`. The plugin verifies them offline by parsing each PE
section table and converting RVA to file offset, so compatibility is known
before any byte is written.

Every write is preceded by a timestamped backup plus a JSON audit record beside
the target. A point whose original bytes are absent, or present more than once,
is skipped and reported — never forced.

**Recovers a dead guest.** When the guest Android framework has died —
`screencap` hangs, `dumpsys` reports a missing window service — the recovery
terminates the instance and its VM helper processes, waits until MuMuManager
reports the instance stopped, launches it again, and polls until the activity
service answers.

## Installing

The plugin is one folder. Copy it to `~/.pi-desktop/plugins/installed/`:

```
cp -r pi-mumu-player ~/.pi-desktop/plugins/installed/hawchou.mumu-player
```

Then enable it in PI-Desktop and run **MuMu Player Toolkit: Open Panel** from
the command palette.

## Using it

The panel opens read-only. Environment, instances, patch state and the command
reference are all readable; the write buttons stay disabled until you turn on
**Enable live controls** in the title bar.

The agent tools:

| Tool | Risk | What it does |
|---|---|---|
| `mumu_detect` | low | resolve the install root and name the source |
| `mumu_list_instances` | low | instance table from `info` |
| `mumu_setting_get` | low | read player settings |
| `mumu_patch_status` | low | classify the DLL and verify all fifty-two points |
| `mumu_command_reference` | low | the shipped command index |
| `mumu_manager_help` | low | verbatim `-h` for any subcommand |
| `mumu_manager` | high | run any subcommand with raw arguments |
| `mumu_instance_action` | high | launch, shut down, restart |
| `mumu_shell` | high | run a command inside the guest |
| `mumu_setting_set` | high | write player settings |
| `mumu_simulation_set` | high | change simulated identity values |
| `mumu_patch_apply` | high | back up, verify, then patch |
| `mumu_patch_restore` | high | restore the newest backup |
| `mumu_recover_dead_guest` | high | the dead-guest recovery |

## Verifying

```
node test/patch-core.test.js
node test/patch-core.test.js "D:\Other\MuMuPlayer"
python tools/i18n-gate.py
```

The patch tests run every destructive case against a copy in the system temp
folder, so the real installation is only ever read. They cover per-point
classification, dry run, byte-exact reproduction of a corrected file, mismatch
refusal, idempotence, restore, and the PE offset cross-check.

Expected output on a healthy 6.8.2 install:

```
PASS  T1 installed file classifies as corrected     already=9/9
PASS  T2 dry run writes nothing                     already=9/9 sha unchanged
PASS  T3 runtime points verify vs the executables   MuMuNxMain.exe=30/30 MuMuNxService.exe=18/18 MuMuRemoteService.exe=4/4
PASS  T8 recorded file offsets match a parsed PE    52 recorded offsets agree
PASS  T4 legacy repaired to the exact corrected sha
PASS  T5 tampered file refused, zero bytes written
PASS  T6 applying twice is idempotent
PASS  T7 restore returns the legacy sha
```

## Reading the guard log

The proxy writes `nx_main\mumu_guard_winhttp.log`. The summary line is the only
proof the runtime points actually landed:

```
=== summary: applied=30 already=0 mismatch=0 skipped=0 total=30 ===   MuMuNxMain
=== summary: applied=18 already=0 mismatch=0 skipped=0 total=18 ===   MuMuNxService
```

`mismatch` greater than zero means the build differs from the point table —
that is the case the nine file corrections exist to fix.

## Scope

The plugin does not ship or install MuMu itself, does not touch account state,
does not repack APKs, and makes no network requests. The patch changes client
behaviour only; it does not change what any account is entitled to on a server.

---

# MuMu 模拟器工具箱

PI-Desktop 的 MuMu 安卓模拟器扩展。自动定位安装目录,驱动 MuMuManager 的完整
指令面,并让 winhttp 代理的 VIP 补丁点位表与已安装的版本保持一致。

## 能力

- **自动识别安装目录**,四条来源按序尝试,面板永远显示本次是**哪一条**命中的:
  手工指定 → 运行中的进程 → 卸载注册表项 → 常见路径。手工路径被拒时会说明原因,
  并保留上一次可用的根目录。
- **完整指令面**:18 个顶层子命令 + 全部嵌套子命令。透传工具原样转发参数;
  调用不存在的子命令时**原样回传 MuMuManager 的报错文本**,不吞错。
- **VIP 补丁**:9 条文件内修正让旧版代理的点位表对上本版本;52 个运行时点位
  通过解析 PE 节表把 RVA 换算成文件偏移,在**不写任何字节**的前提下离线判定兼容性。
  每次写入前先落备份与 JSON 审计记录;原始字节不匹配或非唯一的点位一律跳过。
- **半死 guest 恢复**:guest 安卓框架死掉时(screencap 挂死、dumpsys 报找不到
  window 服务),终止实例与 VM 辅助进程,等实例真停,再拉起,轮询直到 activity
  服务应答。

## 安全

面板默认只读,写入类按钮在打开顶栏「开启操作权限」之前一直是禁用的。
不联网,数据不离开本机。补丁只改变客户端行为,不改变账号在服务端的任何权益。

## 自检

```
node test/patch-core.test.js
python tools/i18n-gate.py
```

补丁测试的破坏性用例全部跑在系统临时目录里的副本上,**真安装只读**。
