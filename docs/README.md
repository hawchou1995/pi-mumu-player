# docs/

## MuMuManager-command-reference.md

Generated. Every `MuMuManager <sub> -h` captured live from the installed build,
one section per subcommand, plus an index of the eighteen top-level entries and
their nested ones.

Regenerate after a MuMu upgrade:

```
node tools/build-command-reference.js "<MuMu root>"
```

The same script rewrites `data/mumu-commands.json`, which is the machine-readable
form the `mumu_command_reference` agent tool serves.

## guest-root-and-module-install.md

Hand-written. The path from a running instance to a Zygisk-based Xposed module loaded
inside one hardened app: `MuMuManager sh` as a uid-0 guest shell, the writable `/system`
overlay, the KernelSU that ships with the image, `ksud module install` for NeoZygisk and
Vector, enabling modules through `modules_config.db` plus a cold boot, and how to tell
"injected" from "inert" (the verbatim Vector loading chain, and a controlled A/B on the
view tree rather than on log tags).

## mobile-browser-lab.md

Hand-written. What runs inside the MuMu Android 12 image and what does not: the browser matrix
against the ARM translation layer, the Google stack (Play services 24.42.33 and Play Store
23.7.11-21 installed through MuMu's own Google installer) plus the measured fact that it changes
nothing about the arm64-Chromium crash, the end-to-end path from an APK download to a verified
result, and a seventeen-row trap table — including the one that matters most for automation:
Tampermonkey 5.3.1 opens its install page for `https://…/x.user.js` only, never for `http://`.
It also documents reading Tampermonkey's own IndexedDB offline (guest root, no UI) to learn which
userscripts are installed and which URLs they cover, which is how the capture regression below
decides between its two install routes.
