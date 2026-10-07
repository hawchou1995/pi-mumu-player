'use strict';

// MuMu Player Toolkit — plugin entry.
//
// Responsibilities:
//   * locate the MuMu installation (manual override, running process, registry,
//     well-known paths) and remember which source won
//   * expose the whole MuMuManager command surface to the agent and the panel
//   * keep nx_main\winhttp.dll in sync with the VIP patch table, with a backup
//     before every write and a hard refusal when the original bytes are absent
//   * recover an instance whose guest Android framework has died

const fs = require('node:fs');
const path = require('node:path');

const mumu = require('./lib/mumu');
const patchEngine = require('./lib/patch');
const staticEngine = require('./lib/static');

const PLUGIN_ROOT = __dirname;
const COMMAND_ID = 'hawchou.mumu-player.open';
const DATA_DIR = path.join(PLUGIN_ROOT, 'data');
const DETECT_TTL_MS = 5000;

let tableCache = null;
let commandCache = null;
let detectCache = { at: 0, value: null };

function patchTables() {
  if (!tableCache) tableCache = patchEngine.readTables(PLUGIN_ROOT);
  return tableCache;
}

function commandDoc() {
  if (!commandCache) {
    try {
      commandCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mumu-commands.json'), 'utf8'));
    } catch {
      commandCache = { schema: 'mumu-manager-commands/1', managerVersion: null, topLevel: [], commands: [] };
    }
  }
  return commandCache;
}

async function readSettings() {
  try {
    return (await pi.plugin.getSettings()) || {};
  } catch {
    return {};
  }
}

async function appLocale() {
  try {
    const value = await pi.app.getLocale();
    return typeof value === 'string' && value ? value : 'en';
  } catch {
    return 'en';
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function succeed(payload) {
  // ok is forced last: several payloads carry an `ok` field of their own, and a
  // spread would otherwise be able to flip the envelope.
  const envelope = Object.assign({}, payload || {});
  envelope.ok = true;
  return envelope;
}

function fail(error) {
  return { ok: false, isError: true, error: describe(error) };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function detect(force) {
  if (!force && detectCache.value && Date.now() - detectCache.at < DETECT_TTL_MS) return detectCache.value;
  const settings = await readSettings();
  const value = mumu.detect({ settings });
  if (value.found) {
    const version = mumu.managerVersion(value.root);
    value.managerVersion = version.version;
    value.managerVersionRaw = version.raw;
  }
  detectCache = { at: Date.now(), value };
  return value;
}

async function resolveRoot(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    const check = mumu.checkRoot(explicit);
    if (!check.ok) {
      const detail = check.reason === 'does-not-exist'
        ? 'the folder does not exist'
        : check.reason === 'no-manager'
          ? 'the folder exists but holds no nx_main\\MuMuManager.exe'
          : check.reason === 'not-absolute'
            ? 'the path must be absolute'
            : 'the path is empty';
      throw new Error(`${detail}: ${explicit}`);
    }
    return check.root;
  }
  const state = await detect(false);
  if (!state.found) throw new Error('no MuMu installation was found; set the manual root in the plugin settings');
  return state.root;
}

// ---------------------------------------------------------------------------
// Instance listing
// ---------------------------------------------------------------------------

function normalizeInstances(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  // `info -v <n>` returns a single flat instance object, while `info -v all`
  // returns an array or an object keyed by index. Normalise all three shapes.
  const looksLikeInstance = !Array.isArray(parsed)
    && (parsed.is_process_started !== undefined || parsed.index !== undefined || parsed.android_version !== undefined);
  const rows = Array.isArray(parsed)
    ? parsed
    : looksLikeInstance
      ? [parsed]
      : Object.values(parsed);
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return { raw: row };
    return {
      index: row.index !== undefined ? String(row.index) : null,
      name: row.name || null,
      running: row.is_process_started === true || row.is_android_started === true || row.player_state === 'start_finished',
      processStarted: row.is_process_started === true,
      androidStarted: row.is_android_started === true,
      playerState: row.player_state || null,
      androidVersion: row.android_version || null,
      adbHost: row.adb_host_ip || null,
      adbPort: row.adb_port || null,
      pid: row.pid || null,
      raw: row,
    };
  });
}

async function instanceList(root, selector) {
  const info = mumu.instanceInfo(root, selector);
  return {
    selector: info.selector,
    ok: info.ok,
    raw: info.raw,
    instances: normalizeInstances(info.parsed),
  };
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

function commandIndex() {
  const doc = commandDoc();
  return {
    schema: doc.schema,
    managerVersion: doc.managerVersion,
    topLevel: doc.topLevel || [],
    entries: (doc.commands || []).map((entry) => ({
      name: entry.name,
      summary: entry.summary,
      usage: entry.usage,
      options: entry.options || [],
      nested: (entry.nested || []).map((nested) => nested.name),
    })),
    entryCount: (doc.commands || []).length,
  };
}

async function panelState() {
  const settings = await readSettings();
  const state = {
    locale: await appLocale(),
    plugin: { id: 'hawchou.mumu-player', version: '0.1.0', root: PLUGIN_ROOT },
    settings: {
      mumuRoot: settings.mumuRoot || '',
      proxySourcePath: settings.proxySourcePath || '',
      keepBackups: settings.keepBackups !== 'off',
    },
    detection: null,
    instances: null,
    patch: null,
    commands: commandIndex(),
    errors: [],
  };

  const det = await detect(false);
  state.detection = det;

  if (det.found) {
    try {
      const info = await instanceList(det.root, 'all');
      state.instances = info;
    } catch (error) {
      state.errors.push(`instances: ${describe(error)}`);
    }
    try {
      state.patch = patchEngine.status(det.root, patchTables());
    } catch (error) {
      state.errors.push(`patch: ${describe(error)}`);
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Recovery: the guest Android framework has died
// ---------------------------------------------------------------------------

function sleeper(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopInstanceProcesses() {
  const names = ['MuMuNxDevice', 'MuMuVMMHeadless', 'MuMuVMMSVC'];
  const script = [
    '$killed = @()',
    '$names = @(' + names.map((name) => `"${name}"`).join(',') + ')',
    'foreach ($n in $names) {',
    '  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {',
    '    $killed += ($n + ":" + $_.Id)',
    '    try { $_.Kill() } catch { }',
    '  }',
    '}',
    '$killed -join ","',
  ].join('; ');
  const result = mumu.run(mumu.powerShellHint(), ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30000 });
  return { killed: result.stdout.trim(), stderr: result.stderr.trim(), ok: result.ok };
}

async function recoverDeadGuest(root, selector, confirmed) {
  if (!confirmed) throw new Error('confirmed must be true: this recovery terminates emulator processes');
  const steps = [];
  const index = String(selector || '0');

  const before = await instanceList(root, index);
  steps.push({ step: 'inspect-before', detail: before.raw.slice(0, 400) });

  const killed = await stopInstanceProcesses();
  steps.push({ step: 'terminate', detail: killed.killed || '(no matching process)' });

  let stopped = false;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleeper(2000);
    const info = await instanceList(root, index);
    const target = info.instances.find((item) => item.index === index) || info.instances[0];
    const started = target ? target.processStarted : false;
    if (!started) {
      stopped = true;
      steps.push({ step: 'stopped', detail: `is_process_started=false after ${(attempt + 1) * 2}s` });
      break;
    }
  }
  if (!stopped) {
    steps.push({ step: 'stopped', detail: 'the instance still reports is_process_started=true after 90s' });
  }

  const launched = mumu.runManager(root, 'control', ['-v', index, 'launch'], 120000);
  steps.push({ step: 'launch', detail: (launched.stdout + launched.stderr).trim().slice(0, 300) });

  let frameworkUp = false;
  let lastProbe = '';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleeper(4000);
    // `adb -v N -c` only understands its own small command set (connect, input_text,
    // key aliases); `sh` is the channel that reaches the device shell.
    const probe = mumu.runManager(root, 'sh', ['-v', index, '-c', 'dumpsys -l'], 30000);
    lastProbe = (probe.stdout + probe.stderr).trim();
    if (/\bactivity\b/.test(lastProbe)) {
      frameworkUp = true;
      steps.push({ step: 'framework', detail: `the activity service answered after ${(attempt + 1) * 4}s` });
      break;
    }
  }
  if (!frameworkUp) {
    steps.push({ step: 'framework', detail: `the activity service did not answer within 240s; last probe: ${lastProbe.slice(0, 200)}` });
  }

  let windowSize = null;
  if (frameworkUp) {
    const size = mumu.runManager(root, 'sh', ['-v', index, '-c', 'wm size'], 30000);
    windowSize = (size.stdout + size.stderr).trim();
    steps.push({ step: 'window-size', detail: windowSize });
  }

  return {
    confirmed,
    vmIndex: index,
    stopped,
    frameworkUp,
    windowSize,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Proxy presence
// ---------------------------------------------------------------------------

// A stock MuMu install has no proxy in nx_main, so the correction table has
// nothing to correct. When the operator has pointed at a proxy file, put it in
// place first; otherwise say why the patch cannot proceed instead of failing
// silently inside the table.
function prepareProxy(root, settings, dryRun) {
  const target = patchEngine.targetDllPath(root);
  const current = patchEngine.inspectFile(target, patchTables());
  if (current.exists && current.markerPresent) {
    return { ready: true, state: current, install: null, reason: null };
  }
  const source = String((settings && settings.proxySourcePath) || '').trim();
  if (!source) {
    return {
      ready: false,
      state: current,
      install: null,
      reason: current.exists
        ? 'the file in nx_main is not the winhttp proxy, and no proxy source is configured'
        : 'there is no winhttp proxy in nx_main and no proxy source is configured',
    };
  }
  const install = patchEngine.installProxy(source, target, {
    dryRun: Boolean(dryRun),
    keepBackups: !settings || settings.keepBackups !== 'off',
  });
  const after = patchEngine.inspectFile(target, patchTables());
  const ready = Boolean(after.exists && after.markerPresent);
  return {
    ready,
    state: after,
    install,
    reason: ready ? null : (install.refused || 'the proxy source could not be installed'),
  };
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

function toolDefs() {
  return [
    {
      name: 'mumu_detect',
      async execute(args) {
        const state = await detect(true);
        if (!state.found) {
          return succeed({
            found: false,
            attempts: state.attempts,
            manualError: state.manualError,
            scanned: state.scanned,
            hint: 'set mumuRoot in the plugin settings to the folder that contains nx_main',
          });
        }
        return succeed({
          found: true,
          root: state.root,
          manager: state.exe,
          source: state.source,
          managerVersion: state.managerVersion,
          attempts: state.attempts,
          scanned: state.scanned,
        });
      },
    },
    {
      name: 'mumu_list_instances',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const info = await instanceList(root, args.vmIndex || 'all');
        return succeed({ root, ...info });
      },
    },
    {
      name: 'mumu_setting_get',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const argv = [];
        if (args.vmIndex) argv.push('-v', String(args.vmIndex));
        if (args.all) argv.push('--all');
        if (args.allWritable) argv.push('--all_writable');
        if (args.key) argv.push('--key', String(args.key));
        if (!argv.length) argv.push('--all_writable');
        const result = mumu.runManager(root, 'setting', argv, 60000);
        return succeed({ root, argv, command: result.command, code: result.code, stdout: result.stdout, stderr: result.stderr });
      },
    },
    {
      name: 'mumu_patch_status',
      async execute(args) {
        const root = await resolveRoot(args.root);
        return succeed(patchEngine.status(root, patchTables()));
      },
    },
    {
      name: 'mumu_command_reference',
      async execute(args) {
        const doc = commandDoc();
        if (args.subcommand) {
          const wanted = String(args.subcommand).trim().toLowerCase();
          const entry = (doc.commands || []).find((item) => item.name.toLowerCase() === wanted);
          if (!entry) {
            return succeed({
              found: false,
              subcommand: args.subcommand,
              available: (doc.commands || []).map((item) => item.name),
            });
          }
          return succeed({ found: true, entry });
        }
        return succeed(commandIndex());
      },
    },
    {
      name: 'mumu_manager_help',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const help = mumu.managerHelp(root, args.subcommand);
        return succeed({ root, help, selection: help.selection });
      },
    },
    {
      name: 'mumu_manager',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const result = mumu.runManager(root, args.subcommand, args.args || [], args.timeoutMs || mumu.DEFAULT_TIMEOUT_MS);
        return succeed({
          root,
          subcommand: args.subcommand,
          argv: args.args || [],
          code: result.code,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
          ms: result.ms,
        });
      },
    },
    {
      name: 'mumu_instance_action',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const index = args.vmIndex || '0';
        const result = mumu.runManager(root, 'control', ['-v', index, args.action], args.action === 'launch' ? 120000 : 90000);
        return succeed({
          root,
          vmIndex: index,
          action: args.action,
          code: result.code,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      },
    },
    {
      name: 'mumu_shell',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const via = args.via === 'adb' ? 'adb' : 'sh';
        const index = args.vmIndex || '0';
        const result = mumu.runManager(root, via, ['-v', index, '-c', args.cmd], args.timeoutMs || 30000);
        return succeed({
          root,
          via,
          vmIndex: index,
          cmd: args.cmd,
          code: result.code,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      },
    },
    {
      name: 'mumu_setting_set',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const argv = [];
        if (args.vmIndex) argv.push('-v', String(args.vmIndex));
        for (const pair of args.pairs || []) {
          argv.push('--key', String(pair.key), '--value', String(pair.value));
        }
        if (!argv.length) throw new Error('at least one key and value pair is required');
        const result = mumu.runManager(root, 'setting', argv, 60000);
        return succeed({ root, argv, code: result.code, stdout: result.stdout, stderr: result.stderr });
      },
    },
    {
      name: 'mumu_simulation_set',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const index = args.vmIndex || '0';
        const result = mumu.runManager(root, 'simulation', ['-v', index, '-sk', args.simuKey, '-sv', args.simuValue], 60000);
        return succeed({ root, vmIndex: index, simuKey: args.simuKey, code: result.code, stdout: result.stdout, stderr: result.stderr });
      },
    },
    {
      name: 'mumu_patch_apply',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const settings = await readSettings();
        const dryRun = Boolean(args.dryRun);
        const prepared = prepareProxy(root, settings, dryRun);
        const report = prepared.ready
          ? patchEngine.applyFile(patchEngine.targetDllPath(root), patchTables(), {
            dryRun,
            keepBackups: settings.keepBackups !== 'off',
          })
          : { refused: prepared.reason, wrote: false, counts: null, points: [] };
        report.proxyInstall = prepared.install || null;
        report.runtime = patchEngine.verifyRuntime(root, patchTables());
        report.guardLog = guardLogSummary(root);
        return succeed(report);
      },
    },
    {
      name: 'mumu_patch_restore',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const target = patchEngine.targetDllPath(root);
        const report = patchEngine.restoreFile(target, args.backup || null, {});
        report.status = patchEngine.inspectFile(target, patchTables());
        return succeed(report);
      },
    },
    {
      name: 'mumu_recover_dead_guest',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const report = await recoverDeadGuest(root, args.vmIndex || '0', Boolean(args.confirmed));
        return succeed(report);
      },
    },
    {
      name: 'mumu_static_patch_status',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const table = staticEngine.readPoints(PLUGIN_ROOT);
        const report = staticEngine.scan(root, table.points);
        report.pointsFile = table.file;
        report.targetVersion = table.doc.targetVersion || null;
        report.backups = staticEngine.listBackups(root);
        return succeed(report);
      },
    },
    {
      name: 'mumu_static_patch_apply',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const table = staticEngine.readPoints(PLUGIN_ROOT);
        const report = staticEngine.apply(root, table.points, {
          dryRun: Boolean(args.dryRun),
          backupBase: args.backupBase || null,
        });
        return succeed(report);
      },
    },
    {
      name: 'mumu_static_patch_restore',
      async execute(args) {
        const root = await resolveRoot(args.root);
        const backups = staticEngine.listBackups(root);
        const backupDir = args.backupDir || (backups[0] && backups[0].dir);
        if (!backupDir) return fail(new Error('no static-patch backup folder found'));
        const report = staticEngine.restore(root, backupDir);
        report.after = staticEngine.scan(root, staticEngine.readPoints(PLUGIN_ROOT).points).totals;
        return succeed(report);
      },
    },
  ];
}

// The guard log is written by the proxy itself; its summary line is the only
// proof that the runtime points actually landed.
function guardLogSummary(root) {
  const candidates = [
    path.join(root, 'nx_main', 'mumu_guard_winhttp.log'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const summary = text.split(/\r?\n/).filter((line) => line.includes('summary:'));
    const hosts = text.split(/\r?\n/).filter((line) => line.includes('host='));
    const blocked = text.split(/\r?\n/).filter((line) => line.includes('BLOCKED'));
    return {
      path: file,
      lastSummary: summary.slice(-4),
      lastHosts: hosts.slice(-4),
      lastBlocked: blocked.slice(-2),
    };
  }
  return { path: candidates[0], missing: true };
}

// ---------------------------------------------------------------------------
// Panel bridge
// ---------------------------------------------------------------------------

async function saveSetting(patchValues) {
  const settings = await readSettings();
  const next = Object.assign({}, settings, patchValues);
  await pi.plugin.setSettings(next);
  detectCache = { at: 0, value: null };
  return next;
}

async function onPanelInvoke(channel, payload) {
  const args = payload || {};
  try {
    switch (channel) {
      case 'mumu.state':
        return await panelState();

      case 'mumu.detect':
        await detect(true);
        return await panelState();

      case 'mumu.setRoot': {
        const raw = String(args.root || '').trim();
        if (!raw) {
          await saveSetting({ mumuRoot: '' });
          return Object.assign(await panelState(), { rootResult: { ok: true, cleared: true } });
        }
        const check = mumu.checkRoot(raw);
        if (!check.ok) {
          // Keep the previous usable root: only the saved setting is left alone.
          const state = await panelState();
          return Object.assign(state, {
            rootResult: {
              ok: false,
              reason: check.reason,
              input: raw,
              probe: check.probe || null,
              keptPrevious: state.detection && state.detection.root ? state.detection.root : null,
            },
          });
        }
        await saveSetting({ mumuRoot: check.root });
        const state = await panelState();
        return Object.assign(state, { rootResult: { ok: true, root: check.root } });
      }

      case 'mumu.clearRoot': {
        await saveSetting({ mumuRoot: '' });
        return await panelState();
      }

      case 'mumu.action': {
        const root = await resolveRoot(args.root);
        const index = args.vmIndex || '0';
        const result = mumu.runManager(root, 'control', ['-v', index, args.action], args.action === 'launch' ? 120000 : 90000);
        const state = await panelState();
        return Object.assign(state, {
          actionResult: { action: args.action, vmIndex: index, code: result.code, output: (result.stdout + result.stderr).trim().slice(0, 1200) },
        });
      }

      case 'mumu.runManager': {
        const root = await resolveRoot(args.root);
        const subcommand = String(args.subcommand || '').trim();
        if (!subcommand) throw new Error('a subcommand is required');
        const parts = String(args.args || '').match(/"[^"]*"|\S+/g) || [];
        const argv = parts.map((item) => item.replace(/^"(.*)"$/, '$1'));
        const result = mumu.runManager(root, subcommand, argv, args.timeoutMs || 60000);
        const state = await panelState();
        return Object.assign(state, {
          runResult: {
            subcommand,
            argv,
            code: result.code,
            timedOut: result.timedOut,
            output: (result.stdout + result.stderr).trim().slice(0, 4000),
          },
        });
      }

      case 'mumu.help': {
        const root = await resolveRoot(args.root);
        return { help: mumu.managerHelp(root, args.subcommand), selection: args.subcommand };
      }

      case 'mumu.shell': {
        const root = await resolveRoot(args.root);
        const via = args.via === 'adb' ? 'adb' : 'sh';
        const result = mumu.runManager(root, via, ['-v', args.vmIndex || '0', '-c', String(args.cmd || '')], 30000);
        const state = await panelState();
        return Object.assign(state, {
          shellResult: { via, cmd: args.cmd, code: result.code, output: (result.stdout + result.stderr).trim().slice(0, 4000) },
        });
      }

      case 'mumu.patchDryRun':
      case 'mumu.patchApply': {
        const root = await resolveRoot(args.root);
        const settings = await readSettings();
        const dryRun = channel === 'mumu.patchDryRun';
        const prepared = prepareProxy(root, settings, dryRun);
        const report = prepared.ready
          ? patchEngine.applyFile(patchEngine.targetDllPath(root), patchTables(), {
            dryRun,
            keepBackups: settings.keepBackups !== 'off',
          })
          : { refused: prepared.reason, wrote: false, counts: null, points: [] };
        const state = await panelState();
        return Object.assign(state, {
          patchResult: report,
          proxyInstall: prepared.install || null,
          guardLog: guardLogSummary(root),
        });
      }
      case 'mumu.patchRestore': {
        const root = await resolveRoot(args.root);
        const report = patchEngine.restoreFile(patchEngine.targetDllPath(root), args.backup || null, {});
        const state = await panelState();
        return Object.assign(state, { patchResult: report });
      }

      case 'mumu.guardLog':
        return { guardLog: guardLogSummary(await resolveRoot(args.root)) };

      case 'mumu.recover': {
        const root = await resolveRoot(args.root);
        const report = await recoverDeadGuest(root, args.vmIndex || '0', Boolean(args.confirmed));
        const state = await panelState();
        return Object.assign(state, { recoverResult: report });
      }

      case 'mumu.getLocale':
        return { locale: await appLocale() };

      default:
        throw new Error(`unknown panel channel: ${channel}`);
    }
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: 'MuMu Player Toolkit: Open Panel / 打开面板',
    keywords: ['mumu', 'emulator', 'android', '模拟器', '安卓', 'vip', 'patch', 'winhttp'],
    run: async () => {
      const locale = await appLocale();
      const title = String(locale).toLowerCase().startsWith('zh') ? 'MuMu 模拟器工具箱' : 'MuMu Player Toolkit';
      await pi.ui.openPanel({ title });
    },
  });

  // Tool metadata lives in manifest.json so the catalogue and the runtime cannot
  // drift apart; the registration reads it back instead of duplicating it.
  const manifestDoc = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'manifest.json'), 'utf8'));
  const declared = new Map(
    ((((manifestDoc.contributes || {}).agentTools) || [])).map((entry) => [entry.name, entry]),
  );
  for (const tool of toolDefs()) {
    const meta = declared.get(tool.name) || {};
    await pi.agent.registerTool({
      name: tool.name,
      description: meta.description || tool.name,
      risk: meta.risk || 'high',
      schema: meta.schema || { type: 'object', properties: {} },
      execute: async (args) => {
        try {
          return await tool.execute(args || {});
        } catch (error) {
          return fail(error);
        }
      },
    });
  }
  // Boot marker: the only observable proof that the host actually loaded this
  // plugin, plus the tool set it registered. Written on every start, and never
  // allowed to block loading.
  try {
    const dataPath = await pi.plugin.getDataPath();
    fs.mkdirSync(dataPath, { recursive: true });
    fs.writeFileSync(
      path.join(dataPath, 'last-load.json'),
      JSON.stringify({
        loadedAt: new Date().toISOString(),
        pluginId: 'hawchou.mumu-player',
        version: '0.1.0',
        pluginRoot: PLUGIN_ROOT,
        node: process.version,
        tools: toolDefs().map((tool) => tool.name),
      }, null, 2),
      'utf8',
    );
  } catch {
    /* a diagnostic marker must never block loading */
  }
}

async function onUnload() {
  try {
    await pi.commands.unregister(COMMAND_ID);
  } catch {
    /* the host may already have torn the registration down */
  }
  for (const tool of toolDefs()) {
    try {
      await pi.agent.unregisterTool(tool.name);
    } catch {
      /* best effort */
    }
  }
}

module.exports = {
  onLoad,
  onUnload,
  onPanelInvoke,
  // exported for tests
  _internal: { detect, resolveRoot, panelState, commandIndex, guardLogSummary, recoverDeadGuest, normalizeInstances, toolDefs },
};
