'use strict';

// Core of the MuMu Player Toolkit: process execution, install-root discovery and
// a thin wrapper over MuMuManager.exe. Everything here is read-only except
// runManager(), which the caller decides how to use.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MANAGER_REL = path.join('nx_main', 'MuMuManager.exe');
const NX_MAIN_DIR = 'nx_main';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_BUFFER = 32 * 1024 * 1024;

// Sources are reported verbatim to the caller, so the panel and the agent tool
// can both say where the root came from. Order here is the order we try them.
const SOURCES = {
  MANUAL: 'manual',
  PROCESS: 'process',
  REGISTRY: 'registry',
  COMMON_PATH: 'common-path',
};

function run(exe, args, options) {
  const timeout = Number.isFinite(options && options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let result;
  try {
    result = spawnSync(exe, args, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      cwd: options && options.cwd ? options.cwd : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
      ms: Date.now() - startedAt,
      command: [exe].concat(args).join(' '),
    };
  }
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return {
    ok: result.status === 0 && !timedOut,
    code: result.status,
    stdout,
    stderr: timedOut ? stderr || `timed out after ${timeout} ms` : stderr,
    timedOut,
    ms: Date.now() - startedAt,
    command: [exe].concat(args).join(' '),
  };
}

function managerPath(root) {
  return root ? path.join(root, MANAGER_REL) : null;
}

// A folder is a MuMu root when it holds nx_main\MuMuManager.exe. Callers may
// hand us the root, the nx_main folder, or the executable itself.
function candidatesFrom(candidate) {
  const out = [];
  const push = (value) => {
    if (value && !out.some((item) => item.toLowerCase() === value.toLowerCase())) out.push(value);
  };
  const base = path.basename(candidate).toLowerCase();
  if (base === 'mumumanager.exe') {
    push(path.dirname(candidate));
    push(path.dirname(path.dirname(candidate)));
    push(path.dirname(path.dirname(path.dirname(candidate))));
  } else if (base === NX_MAIN_DIR) {
    push(path.dirname(candidate));
    push(candidate);
  } else {
    push(candidate);
  }
  return out;
}

function resolveManual(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const cleaned = raw.trim().replace(/^"(.*)"$/, '$1');
  const attempts = candidatesFrom(cleaned);
  const probed = [];
  for (const attempt of attempts) {
    const resolved = path.resolve(attempt);
    probed.push(resolved);
    const exe = managerPath(resolved);
    if (exe && fs.existsSync(exe)) return { root: resolved, exe, probed };
  }
  return { root: null, exe: null, probed, manualMissing: true, manualRaw: cleaned };
}

function powershellHint() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const preferred = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(preferred) ? preferred : 'powershell.exe';
}

// One PowerShell call returns both the running process path and every uninstall
// registry entry that looks like MuMu. Two independent sources, one spawn.
function probeWindows() {
  const script = [
    '$out = [ordered]@{ processPath = $null; registry = @() }',
    '$names = @("MuMuNxMain","MuMuNxService","MuMuNxDevice","MuMuNxLauncher")',
    '$p = Get-Process -Name $names -ErrorAction SilentlyContinue | Select-Object -First 1',
    'if ($p) { try { $out.processPath = $p.Path } catch { } }',
    '$bases = @(',
    '  "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
    '  "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
    '  "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
    ')',
    '$found = @()',
    'foreach ($base in $bases) {',
    '  Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {',
    '    $x = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
    '    if ($x -and $x.DisplayName -match "MuMu" -and $x.InstallLocation) { $found += [string]$x.InstallLocation }',
    '  }',
    '}',
    '$out.registry = @($found | Select-Object -Unique)',
    '$out | ConvertTo-Json -Compress',
  ].join('; ');

  const result = run(powershellHint(), ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 20000 });
  if (!result.ok || !result.stdout.trim()) return { processPath: null, registry: [] };
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return {
      processPath: typeof parsed.processPath === 'string' ? parsed.processPath : null,
      registry: Array.isArray(parsed.registry) ? parsed.registry : parsed.registry ? [parsed.registry] : [],
    };
  } catch {
    return { processPath: null, registry: [] };
  }
}

// Every well-known place a MuMu install has been seen to live, plus a shallow
// scan of the usual vendor folders. No environment variable is trusted blindly.
function commonPathRoots() {
  const env = process.env;
  const roots = new Set();
  const vendorDirs = new Set();

  const programFiles = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']].filter(Boolean);
  for (const base of programFiles) {
    roots.add(path.join(base, 'Netease', 'MuMuPlayer'));
    roots.add(path.join(base, 'Netease', 'MuMuPlayer-12.0'));
    roots.add(path.join(base, 'Netease', 'MuMuPlayer12'));
    roots.add(path.join(base, 'MuMuPlayer'));
    vendorDirs.add(path.join(base, 'Netease'));
  }
  if (env.LOCALAPPDATA) {
    roots.add(path.join(env.LOCALAPPDATA, 'Netease', 'MuMuPlayer'));
    vendorDirs.add(path.join(env.LOCALAPPDATA, 'Netease'));
  }
  if (env.ProgramData) vendorDirs.add(path.join(env.ProgramData, 'Netease'));
  for (const drive of ['C', 'D', 'E', 'F']) {
    roots.add(`${drive}:\\Program Files\\Netease\\MuMuPlayer`);
    roots.add(`${drive}:\\Netease\\MuMuPlayer`);
    roots.add(`${drive}:\\MuMuPlayer`);
  }

  // A shallow scan catches installs that were moved or renamed, which is the
  // case the fixed list tends to miss.
  for (const dir of vendorDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) roots.add(path.join(dir, entry.name));
    }
  }
  return Array.from(roots);
}

function firstExistingRoot(list) {
  for (const dir of list) {
    const resolved = path.resolve(dir);
    const exe = managerPath(resolved);
    if (exe && fs.existsSync(exe)) return { root: resolved, exe };
  }
  return null;
}

function managerVersion(root) {
  const exe = managerPath(root);
  if (!exe || !fs.existsSync(exe)) return { ok: false, version: null, raw: '' };
  const result = run(exe, ['version'], { timeoutMs: 20000 });
  const raw = (result.stdout + result.stderr).trim();
  let version = null;
  try {
    version = JSON.parse(result.stdout.trim()).version || null;
  } catch {
    const match = /"version"\s*:\s*"([^"]+)"/.exec(raw);
    version = match ? match[1] : null;
  }
  return { ok: result.ok, version, raw };
}

// Detection order is the documented contract: manual, running process,
// registry, well-known paths. The first source that yields a usable root wins,
// and every attempt is kept so the caller can explain what happened.
function detect(options) {
  const settings = (options && options.settings) || {};
  const useManual = !(options && options.useManual === false);
  const attempts = [];
  const manualProbe = useManual ? resolveManual(settings.mumuRoot) : null;

  if (manualProbe && manualProbe.root) {
    return {
      found: true,
      root: manualProbe.root,
      exe: manualProbe.exe,
      source: SOURCES.MANUAL,
      attempts,
      manualError: null,
      scanned: { process: null, registry: [], commonPaths: 0 },
    };
  }
  if (manualProbe && manualProbe.manualMissing) {
    attempts.push({ source: SOURCES.MANUAL, ok: false, detail: manualProbe.manualRaw, probed: manualProbe.probed });
  }

  const win = probeWindows();
  const processProbe = win.processPath ? resolveManual(win.processPath) : null;
  if (processProbe && processProbe.root) {
    return {
      found: true,
      root: processProbe.root,
      exe: processProbe.exe,
      source: SOURCES.PROCESS,
      attempts,
      manualError: manualProbe && manualProbe.manualMissing ? manualProbe.manualRaw : null,
      scanned: { process: win.processPath, registry: win.registry, commonPaths: 0 },
    };
  }
  attempts.push({ source: SOURCES.PROCESS, ok: false, detail: win.processPath || null, probed: [] });

  const registryRoots = [];
  for (const entry of win.registry) {
    const probe = resolveManual(entry);
    if (probe && probe.root) {
      registryRoots.push(probe.root);
    } else {
      for (const p of (probe && probe.probed) || []) registryRoots.push(p);
    }
  }
  const registryHit = firstExistingRoot(registryRoots);
  if (registryHit) {
    return {
      found: true,
      root: registryHit.root,
      exe: registryHit.exe,
      source: SOURCES.REGISTRY,
      attempts,
      manualError: manualProbe && manualProbe.manualMissing ? manualProbe.manualRaw : null,
      scanned: { process: win.processPath, registry: win.registry, commonPaths: 0 },
    };
  }
  attempts.push({ source: SOURCES.REGISTRY, ok: false, detail: win.registry.join('; ') || null, probed: registryRoots });

  const commonRoots = commonPathRoots();
  const commonHit = firstExistingRoot(commonRoots);
  if (commonHit) {
    return {
      found: true,
      root: commonHit.root,
      exe: commonHit.exe,
      source: SOURCES.COMMON_PATH,
      attempts,
      manualError: manualProbe && manualProbe.manualMissing ? manualProbe.manualRaw : null,
      scanned: { process: win.processPath, registry: win.registry, commonPaths: commonRoots.length },
    };
  }
  attempts.push({ source: SOURCES.COMMON_PATH, ok: false, detail: null, probed: commonRoots });

  return {
    found: false,
    root: null,
    exe: null,
    source: null,
    attempts,
    manualError: manualProbe && manualProbe.manualMissing ? manualProbe.manualRaw : null,
    scanned: { process: win.processPath, registry: win.registry, commonPaths: commonRoots.length },
  };
}

// Validates a caller-supplied folder the same way detection does, so the panel
// can report a precise reason instead of a bare "not found".
function checkRoot(dir) {
  if (typeof dir !== 'string' || !dir.trim()) {
    return { ok: false, reason: 'empty', root: null, exe: null };
  }
  const cleaned = dir.trim().replace(/^"(.*)"$/, '$1');
  if (!path.isAbsolute(cleaned)) {
    return { ok: false, reason: 'not-absolute', root: null, exe: null, input: cleaned };
  }
  const resolved = path.resolve(cleaned);
  if (!fs.existsSync(resolved)) {
    return { ok: false, reason: 'does-not-exist', root: resolved, exe: null, input: cleaned };
  }
  const attempts = candidatesFrom(resolved);
  for (const attempt of attempts) {
    const exe = managerPath(attempt);
    if (exe && fs.existsSync(exe)) return { ok: true, reason: null, root: attempt, exe, input: cleaned };
  }
  return { ok: false, reason: 'no-manager', root: resolved, exe: null, input: cleaned, probe: managerPath(resolved) };
}

function runManager(root, subcommand, args, timeoutMs) {
  const exe = managerPath(root);
  if (!exe || !fs.existsSync(exe)) {
    return { ok: false, code: null, stdout: '', stderr: `MuMuManager.exe not found under ${root || '(no root)'}`, timedOut: false, ms: 0, command: '', missingManager: true };
  }
  const argv = [String(subcommand)].concat((args || []).map((value) => String(value)));
  return run(exe, argv, { timeoutMs });
}

// `MuMuManager <sub> -h` prints the subcommand help on stdout and exits. Nested
// subcommands are addressed by passing the whole path as one selection.
function managerHelp(root, selection) {
  const parts = String(selection || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) parts.push('-h');
  const argv = parts.concat(['-h']);
  const result = runManager(root, argv[0], argv.slice(1), 20000);
  return { selection: parts.join(' '), text: (result.stdout + result.stderr).trim(), ok: result.ok };
}

function instanceInfo(root, selector) {
  const result = runManager(root, 'info', ['-v', selector || 'all'], 30000);
  const raw = (result.stdout + result.stderr).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = null;
  }
  return { ok: result.ok, raw, parsed, selector: selector || 'all' };
}

module.exports = {
  MANAGER_REL,
  SOURCES,
  DEFAULT_TIMEOUT_MS,
  run,
  managerPath,
  detect,
  checkRoot,
  resolveManual,
  managerVersion,
  runManager,
  managerHelp,
  instanceInfo,
  commonPathRoots,
  powerShellHint: () => powerShellHint(),
  tmpDir: () => os.tmpdir(),
};
