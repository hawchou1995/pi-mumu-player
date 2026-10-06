# Guest-side root and Xposed module install

Everything here is driven through `MuMuManager` that the toolkit already wraps. It
documents the path from "the emulator is running" to "a Zygisk-based Xposed module is
loaded inside a specific app", which is what you need when an app refuses to be
repackaged (hardened shells, signature self-checks).

Verified on MuMu Player 6.8.2.0, instance series 15.0 (Android 15), 2026-10-06.

## 1. `MuMuManager sh` is a guest shell with uid 0

`sh` runs its `--cmd` **inside the guest as root**, in the MuMu init context:

```
> MuMuManager.exe sh -v 2 "id"
uid=0(root) gid=0(root) groups=0(root) context=u:r:nemuinit:s0
```

That is the whole trick: you do not need the graphical "root permission" switch, and
you do not need Magisk. The command form is
`MuMuManager sh --vmindex <n> --cmd "<command>"`; the `mumu_shell` agent tool already
exposes it (use `via: "sh"`).

`sh` also accepts the input shortcuts (`input_text`, `go_back`, `go_home`, `go_task`,
`key_enter`, the volume keys), so it doubles as an input channel.

## 2. Make `/system` writable (persistent overlay)

```
> MuMuManager.exe setting -v 2 -k system_disk_readonly -val false
> MuMuManager.exe setting -v 2 -k root_permission     -val true
```

`system_disk_readonly=false` gives the guest a **writable `/system` overlay**
(`lowerdir=/system, upperdir=/mnt/scratch/upperdir`), so `mount -o remount,rw /system`
succeeds. Two notes worth knowing before you spend time on them:

- `root` is a **read-only status field**. `setting -k root -val true` answers
  `errcode -101 "key not writable"`; editing `"root"` inside `vms/<inst>/configs/vm_config.json`
  by hand changes nothing.
- `root_permission` **alone does not give you `su`**. After setting it and cold-booting,
  `/system/bin/su`, `/system/xbin/su` and `magisk` are all still absent. Root comes from
  `sh` (section 1), not from this key.

## 3. The image already ships KernelSU — no Magisk needed

```
> MuMuManager.exe sh -v 2 "ksud -V"
ksud 3.2.5
> MuMuManager.exe sh -v 2 "ls /data/adb"
ksu
ksud
```

`/data/adb/ksud` is a ~3.7 MB executable and `/data/adb/ksu/bin` holds `busybox` and
`resetprop`; `/data/adb/ksu/log/` carries live `dmesg.log` and `logcat.log`. KernelSU
reports its own version during a module install (`KernelSU version: 32525 (kernel) +
32525 (ksud)`).

## 4. Install Zygisk and the Xposed framework as KernelSU modules

Push the zips into the guest first (`adb push <zip> /data/local/tmp/`), then:

```
> MuMuManager.exe sh -v 2 "/data/adb/ksud module install /data/local/tmp/NeoZygisk.zip"
> MuMuManager.exe sh -v 2 "/data/adb/ksud module install /data/local/tmp/Vector.zip"
```

- **NeoZygisk** (the Zygisk engine) prints `KernelSU version too large! Support for
  KernelSU (variant) could be incomplete` on a 32525 kernel and then installs anyway,
  extracting `bin/x86_64/zygiskd`, `lib/x86_64/libzygisk.so` and
  `lib/x86_64/libzygisk_ptrace.so`. Do not stop on that warning.
- **Vector** (the LSPosed successor) extracts its Zygisk libraries, `dex2oat` helpers
  and `manager.apk`, and runs its own `Patching binaries for anti-detection` step.

`ksud module list` should show both with `enabled: true`. Cold-boot the instance, then
confirm the processes:

```
root    627    1  zygisk-ptrace64     <- NeoZygisk injector
root    673  627  zygiskd64           <- zygisk daemon
system  863    1  vectord             <- Vector (LSPosed) daemon
```

## 5. Enable your module: the DB, not the UI

Installing the APK is only half of it. LSPosed keeps a module table and a scope table:

```
DB = /data/adb/lspd/config/modules_config.db
INSERT INTO modules(module_pkg_name, apk_path, enabled, auto_include)
  VALUES('<module.id>', '<abs path to base.apk>', 1, 0);
INSERT OR REPLACE INTO scope(mid, app_pkg_name, user_id)
  SELECT mid, '<target.pkg>', 0 FROM modules WHERE module_pkg_name='<module.id>';
```

Two traps, both of which cost real time:

- **`enabled` defaults to 0 and `scope` is empty.** A row in `modules` means the module
  was *discovered*, not that anything injects.
- **`lspd` caches the module table at daemon start.** Change the DB and you must
  **cold-boot the instance**; otherwise the module still loads and you will conclude
  your "off" control arm was off when it was not. Check
  `/data/adb/lspd/log/modules_*.log`: `----part 1 start----` with nothing after it means
  **zero** modules were loaded for injection.

Vector's own `cli` may be unusable in the guest
(`CANNOT LINK EXECUTABLE "/system/bin/app_process": library "libnativeloader.so" not found`).
Use `/system/bin/sqlite3` against the DB directly instead.

Run these through `MuMuManager sh` (root) — `adb shell` as `shell` cannot read
`/data/adb/lspd/`.

## 6. The injection proof string

Do not judge an Xposed module by counting an app's own log tags. The proof is this
chain, verbatim, in the target process:

```
Vector  : Loading Vector/Xposed for <target.pkg> (UID: <n>)
VectorModuleManager: Loading module <module.id>
VectorModuleManager: Loading class class <module.id>.MainHook
<Module>: <module.id>: ... module loaded.
VectorModuleManager: Loaded module <module.id> successfully.
```

Note that the Zygisk **denylist is not a blocker**: a process listed as
`zygisk-core64: [<target.pkg>] is on the denylist` still gets the module injected (the
denylist only hides root mounts). Confirm by matching `callerUid` in the
`VectorZygiskBridge` lines against `dumpsys package <pkg> | grep userId`.

## 7. Module shape: three things that do not work, and two that do

When the target is a hardened shell, the app's classes do not live in the classloader
you get in `handleLoadPackage`.

| Attempt | Result |
|---|---|
| Hook the advertised method names on `lpparam.classLoader` | `ClassNotFoundException` for every ad SDK class — a hardened shell builds its own child classloader for the payload |
| Hook `ClassLoader.loadClass` and install hooks by class name | The watcher installs, but it catches only a handful of classes: most payload classes never go through the Java `loadClass` |
| `ViewGroup.addView` guard | **Works.** Read `view.getClass().getName()` when a view enters the tree and `setResult(null)` for SDK-prefixed classes. No class discovery, no method names, and anything rendered must enter the tree |
| Captured classloader | **Works.** The view you just blocked carries the classloader that owns the whole SDK: `view.getClass().getClassLoader()`, then `Class.forName(...)` against it and hook `init` / `loadAd` |
| Mixing module declaration formats | Legacy `de.robv.android.xposed` classes with the modern `META-INF/xposed/java_init.list` declaration fail with `ClassNotFoundException`. Use the classic form (`assets/xposed_init` plus the manifest `<meta-data name="xposedmodule" value="true"/>`) for a legacy-API module |

## 8. Measuring "no ads" on a hardened target

Blocking the render does not stop the SDK. It keeps initialising, keeps requesting, and
retries when its view cannot attach, so **tag counts go up, not down**. Two rules:

- Judge by the **view tree**, not by tags. `adb shell dumpsys activity top` and look for
  the ad nodes (`NativeAdContainer`, `ad_image`, `ad_desc`, `ad_close_area`,
  `download_action`, `LottieAnimationView`, `CenterImageView`). An ad card that
  collapses to zero height is the signal.
- Run a **controlled A/B**: uninstall the module and cold-boot for the "before" arm, then
  install + enable + cold-boot for the "after" arm, and take **several windows on each
  side**. Ad fill is not deterministic, so a single window versus an old window proves
  nothing. If the app is a ViewPager with a Flutter surface, one `dumpsys activity top`
  already contains every page — compare page anchors to prove both arms cover the same
  screens, because accessibility dumps cannot decompose the Flutter surface.
