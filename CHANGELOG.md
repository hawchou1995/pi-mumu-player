# Changelog

## 0.3.0 — 2026-10-07

**Static patch, no proxy required.** The toolkit no longer depends on a
user-supplied `winhttp.dll` to change client behaviour. `lib/static.js` applies the
same fifty-two runtime points straight to the on-disk `MuMuNxMain.exe`,
`MuMuNxService.exe` and `MuMuRemoteService.exe`, locating each point by the RVA in
`patch/points.json` mapped through the parsed PE section table. Three new agent
tools: `mumu_static_patch_status` (read-only, low risk), `mumu_static_patch_apply`
and `mumu_static_patch_restore` (high risk). Every touched file is backed up with a
timestamped copy plus an audit JSON, and a point whose original bytes are absent is
skipped rather than forced.

Stub points — where `patch` is shorter than `orig` — have the remainder of the
original function body filled with NOPs, so the file size and every later offset are
preserved. A running executable cannot be replaced, so stop MuMu before applying;
`MuMuRemoteService` is a Windows service and has to be stopped as well.

**Verifier fix.** `verifyRuntime()` compared a whole `orig`-length window against
`patch` (three bytes on the two stub points in `MuMuNxMain.exe`), so those two could
never be classified as applied and always showed as `mismatch`, even on a correctly
patched file. It now compares only the leading `patch` bytes.

## 0.2.0 — 2026-10-06

Documentation: the guest-side root path and module install.

**Guest root without a GUI switch.** `MuMuManager sh` executes inside the guest as
`uid=0(root)` / `context=u:r:nemuinit:s0`. Documented, together with the two settings
that matter (`system_disk_readonly=false` for a writable `/system` overlay, and the
fact that `root_permission` alone never produces a `su`).

**KernelSU is already in the image.** `ksud 3.2.5` and `/data/adb/ksu` are present, so
NeoZygisk and Vector install as KernelSU modules with no Magisk. Cold boot, then confirm
`zygisk-ptrace64`, `zygiskd64` and `vectord`.

**Enabling a module is a DB operation.** `modules.enabled` defaults to 0 and `scope` is
empty; both have to be written in `/data/adb/lspd/config/modules_config.db`, and `lspd`
caches the table at daemon start, so a cold boot is required — otherwise an "off"
control arm is silently still on. The log file to check is
`/data/adb/lspd/log/modules_*.log`.

**De-adding an app that cannot be repackaged.** Why `addView` guards work on a hardened
shell when class-name hooks do not, how to reach the real classloader from the view you
just blocked, and why the right metric is the view tree (with a controlled A/B) rather
than SDK log tags.

New: `docs/guest-root-and-module-install.md`.

## 0.1.0 — 2026-10-05

First release.

**Environment detection.** Resolves the MuMu install root from four sources in
order: the manual override in settings, a running MuMu process, the uninstall
registry entry, and the well-known install paths. The panel always names which
source won, and a rejected manual path reports the reason without discarding the
previously working root.

**Command surface.** All eighteen MuMuManager subcommands plus their nested ones
are reachable: version, info, create, clone, upgrade, delete, rename, import,
export, control, setting, adb, simulation, sort, driver, log, sh, main. The
captured help text and a parsed option index ship in data/mumu-commands.json and
docs/MuMuManager-command-reference.md.

**VIP patch.** A two-part table keeps nx_main\winhttp.dll aligned with the
installed build. Nine in-file corrections turn a proxy built for the earlier
build into one that matches this build; fifty-two runtime points are verified
against the three target executables by parsing their PE section tables. Every
write is preceded by a timestamped backup and an audit record, and a point whose
original bytes are absent or not unique is skipped rather than forced.

When nx_main holds no proxy at all, the plugin says so instead of failing inside
the table; point the setting at a proxy file and it is copied into place first,
with the guard marker checked and the previous file backed up, and the
corrections are applied on top.

**Dead guest recovery.** Recovers an instance whose guest Android framework has
died, following the documented procedure: terminate the instance and its VM
helpers, wait until MuMuManager reports the instance stopped, launch again, and
wait for the activity service to answer.

**Safety.** The panel starts read-only; write actions stay disabled until the
operator turns on live controls. No network access.
