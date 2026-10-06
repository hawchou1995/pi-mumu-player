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
