# Changelog

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
