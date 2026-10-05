'use strict';

// Host contract test. PI-Desktop only scans plugins at start-up, so this runs
// main.js against a stubbed `pi` API shaped like the real one and exercises the
// whole contract: load, command, every panel channel that reads, every tool,
// and the error paths. If this passes, the plugin is loadable by construction —
// the only remaining step is the host's own scan.
//
//   node test/host-contract.test.js
//
// Covers: AC-1 (detection, manual override, rejection paths), AC-3 (command
// surface and pass-through), AC-4.2 / AC-4.3 (manifest and copy table).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REAL_ROOT = process.argv[2] || process.env.MUMU_ROOT || 'C:\\Program Files\\Netease\\MuMuPlayer';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mumu-host-test-'));

const lines = [];
let failures = 0;

function ok(name, detail) {
  lines.push('PASS  ' + name + (detail ? '  ' + detail : ''));
}

function bad(name, error) {
  failures += 1;
  lines.push('FAIL  ' + name + '  ' + (error instanceof Error ? error.message : String(error)));
}

async function check(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (error) {
    bad(name, error);
  }
}

// ---------------------------------------------------------------------------
// Stub host
// ---------------------------------------------------------------------------

const registry = {
  commands: new Map(),
  tools: new Map(),
  settings: { mumuRoot: '', proxySourcePath: '', keepBackups: 'on' },
  panels: [],
};

global.pi = {
  plugin: {
    async getSettings() {
      return Object.assign({}, registry.settings);
    },
    async setSettings(next) {
      registry.settings = Object.assign({}, registry.settings, next);
      return registry.settings;
    },
    async getDataPath() {
      return DATA_DIR;
    },
  },
  commands: {
    async register(definition) {
      registry.commands.set(definition.id, definition);
      return definition;
    },
    async unregister(id) {
      registry.commands.delete(id);
    },
  },
  agent: {
    async registerTool(definition) {
      registry.tools.set(definition.name, definition);
      return definition;
    },
    async unregisterTool(name) {
      registry.tools.delete(name);
    },
  },
  ui: {
    async openPanel(options) {
      registry.panels.push(options);
      return options;
    },
  },
  app: {
    async getLocale() {
      return 'zh-CN';
    },
  },
};

const main = require('../main.js');
const mumu = require('../lib/mumu');
const patchEngine = require('../lib/patch');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'manifest.json'), 'utf8'));

async function run() {
  lines.push('plugin  ' + PLUGIN_ROOT);
  lines.push('real    ' + REAL_ROOT);
  lines.push('data    ' + DATA_DIR);
  lines.push('');

  // --- load -----------------------------------------------------------------
  await check('L1 onLoad registers the command and every declared tool', async () => {
    await main.onLoad();
    assert.equal(registry.commands.size, 1, 'expected exactly one command');
    const declared = MANIFEST.contributes.agentTools.map((entry) => entry.name).sort();
    const registered = Array.from(registry.tools.keys()).sort();
    assert.deepEqual(registered, declared, 'registered tools differ from the manifest');
    for (const name of registered) {
      const tool = registry.tools.get(name);
      assert.ok(tool.description && tool.description.length > 20, name + ': no description');
      assert.ok(tool.risk === 'low' || tool.risk === 'high', name + ': bad risk ' + tool.risk);
      assert.ok(tool.schema && tool.schema.type === 'object', name + ': no object schema');
    }
    return declared.length + ' tools, 1 command';
  });

  await check('L2 the boot marker lands in the plugin data directory', async () => {
    const marker = path.join(DATA_DIR, 'last-load.json');
    assert.ok(fs.existsSync(marker), 'boot marker missing at ' + marker);
    const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(parsed.pluginId, 'hawchou.mumu-player');
    assert.ok(Array.isArray(parsed.tools) && parsed.tools.length === MANIFEST.contributes.agentTools.length);
    return parsed.tools.length + ' tools at ' + parsed.loadedAt;
  });

  const call = async (name, args) => {
    const tool = registry.tools.get(name);
    if (!tool) throw new Error('tool not registered: ' + name);
    const result = await tool.execute(args || {});
    if (result && result.ok === false) throw new Error(result.error || 'tool reported failure');
    return result;
  };

  // --- AC-1 -----------------------------------------------------------------
  let detectedRoot = null;
  await check('A1.1 automatic detection resolves the root and the manager version', async () => {
    const result = await call('mumu_detect', {});
    assert.equal(result.found, true, 'no installation found');
    assert.ok(fs.existsSync(result.manager), 'manager executable missing at ' + result.manager);
    detectedRoot = result.root;
    // On a machine where the manual override is empty the source must be automatic.
    return 'root=' + result.root + ' source=' + result.source + ' version=' + result.managerVersion;
  });

  await check('A1.2 the resolved source is one of the four documented values', async () => {
    const result = await call('mumu_detect', {});
    const allowed = ['manual', 'process', 'registry', 'common-path'];
    assert.ok(allowed.includes(result.source), 'unexpected source: ' + result.source);
    const reasons = result.attempts.map((attempt) => attempt.source);
    return 'source=' + result.source + ' attempted=[' + reasons.join(',') + ']';
  });

  await check('A1.3 a nonexistent manual root is rejected and the previous root survives', async () => {
    const missing = path.join(os.tmpdir(), 'definitely-not-a-mumu-root-' + Date.now());
    const state = await main.onPanelInvoke('mumu.setRoot', { root: missing });
    assert.equal(state.rootResult.ok, false, 'a nonexistent path was accepted');
    assert.equal(state.rootResult.reason, 'does-not-exist', 'reason was ' + state.rootResult.reason);
    assert.equal(state.detection.found, true, 'detection was lost after a rejected path');
    assert.equal(state.detection.root, detectedRoot, 'the previous root was not kept');
    return 'reason=' + state.rootResult.reason + ' kept=' + state.detection.root;
  });

  await check('A1.4 a real folder without nx_main is rejected as no-manager', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mumu-not-a-root-'));
    const state = await main.onPanelInvoke('mumu.setRoot', { root: empty });
    assert.equal(state.rootResult.ok, false, 'a folder without a manager was accepted');
    assert.equal(state.rootResult.reason, 'no-manager', 'reason was ' + state.rootResult.reason);
    assert.equal(state.detection.root, detectedRoot, 'the previous root was not kept');
    return 'reason=' + state.rootResult.reason + ' probe=' + (state.rootResult.probe || '');
  });

  await check('A1.5 accepting the nx_main folder or the executable itself also works', async () => {
    const viaNxMain = mumu.checkRoot(path.join(REAL_ROOT, 'nx_main'));
    assert.equal(viaNxMain.ok, true, 'nx_main form rejected: ' + viaNxMain.reason);
    const viaExe = mumu.checkRoot(path.join(REAL_ROOT, 'nx_main', 'MuMuManager.exe'));
    assert.equal(viaExe.ok, true, 'exe form rejected: ' + viaExe.reason);
    assert.equal(viaNxMain.root, viaExe.root, 'the two forms resolved differently');
    return 'both resolve to ' + viaNxMain.root;
  });

  await check('A1.6 the panel state names the source and the root', async () => {
    const state = await main.onPanelInvoke('mumu.state', {});
    assert.ok(state.detection.found, 'panel state has no detection');
    assert.ok(state.detection.source, 'panel state has no source');
    assert.equal(state.detection.root, detectedRoot);
    assert.equal(state.locale, 'zh-CN', 'locale was not read');
    return 'source=' + state.detection.source;
  });

  // --- AC-3 -----------------------------------------------------------------
  await check('A3.1 the reference covers all eighteen top-level subcommands', async () => {
    const index = await call('mumu_command_reference', {});
    const expected = ['version', 'info', 'create', 'clone', 'upgrade', 'delete', 'rename',
      'import', 'export', 'control', 'setting', 'adb', 'simulation', 'sort', 'driver', 'log', 'sh', 'main'];
    assert.equal(index.topLevel.length, 18, 'topLevel has ' + index.topLevel.length);
    for (const name of expected) {
      assert.ok(index.topLevel.includes(name), 'missing subcommand: ' + name);
      const entry = index.entries.find((item) => item.name === name);
      assert.ok(entry, 'no reference entry for ' + name);
      assert.ok(entry.summary && entry.summary.length > 4, name + ' has no summary');
    }
    return index.entryCount + ' entries, ' + index.topLevel.length + ' top-level';
  });

  await check('A3.2 every reference entry carries verbatim help text', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'data', 'mumu-commands.json'), 'utf8'));
    const missing = doc.commands.filter((entry) => !entry.help || entry.help.length < 40);
    assert.equal(missing.length, 0, 'entries without help text: ' + missing.map((e) => e.name).join(', '));
    return doc.commands.length + ' entries, shortest help ' + Math.min.apply(null, doc.commands.map((e) => e.help.length)) + ' chars';
  });

  await check('A3.3 live help for a subcommand and a nested one', async () => {
    const top = await call('mumu_manager_help', { subcommand: 'control' });
    assert.ok(top.help.text.includes('SUBCOMMANDS'), 'control help lost its subcommand list');
    assert.ok(/launch/.test(top.help.text) && /shutdown/.test(top.help.text), 'control help lost launch/shutdown');
    const nested = await call('mumu_manager_help', { subcommand: 'main engine' });
    assert.ok(nested.help.text.length > 20, 'nested help came back empty');
    return 'control ' + top.help.text.length + ' chars, main engine ' + nested.help.text.length + ' chars';
  });

  await check('A3.4 version returns the manager version over the pass-through', async () => {
    const result = await call('mumu_manager', { subcommand: 'version' });
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(parsed.version, 'no version in the payload');
    assert.equal(result.code, 0, 'exit code was ' + result.code);
    return 'version=' + parsed.version;
  });

  await check('A3.5 info returns is_process_started for the instance', async () => {
    const result = await call('mumu_list_instances', { vmIndex: '0' });
    assert.ok(result.instances.length > 0, 'no instance rows');
    const row = result.instances[0];
    assert.ok(typeof row.processStarted === 'boolean', 'is_process_started was not parsed');
    assert.ok(row.raw && typeof row.raw === 'object', 'raw row missing');
    return 'index=' + row.index + ' processStarted=' + row.processStarted + ' android=' + row.androidVersion;
  });

  await check('A3.6 an unknown subcommand returns MuMuManager error text, not a crash', async () => {
    const result = await call('mumu_manager', { subcommand: 'not-a-real-subcommand' });
    const text = (result.stdout + result.stderr).trim();
    assert.ok(text.length > 0, 'no error text came back');
    assert.ok(/unknown cmd|not a real|SUBCOMMANDS|OVERVIEW/i.test(text), 'unexpected error text: ' + text.slice(0, 120));
    return text.split('\n')[0].slice(0, 70);
  });

  await check('A3.7 a nested subcommand is reachable through the pass-through', async () => {
    const result = await call('mumu_manager', { subcommand: 'control', args: ['-h'] });
    assert.ok(/launch/.test(result.stdout), 'control -h did not list launch');
    return 'exit=' + result.code;
  });

  // --- AC-2 -----------------------------------------------------------------
  await check('A2.1 the panel reports per-point counts without writing', async () => {
    const state = await main.onPanelInvoke('mumu.state', {});
    assert.ok(state.patch, 'no patch state in the panel payload');
    const counts = state.patch.file.counts;
    assert.equal(counts.total, 9, 'file point count is ' + counts.total);
    assert.ok(typeof counts.applied === 'number' && typeof counts.mismatch === 'number' && typeof counts.skipped === 'number');
    return 'applied=' + counts.applied + ' already=' + counts.already + ' mismatch=' + counts.mismatch + ' skipped=' + counts.skipped + ' total=' + counts.total;
  });

  await check('A2.1b the runtime point table verifies against all three executables', async () => {
    const state = await main.onPanelInvoke('mumu.state', {});
    const byHost = Object.fromEntries(state.patch.runtime.map((host) => [host.host, host.counts]));
    assert.equal(byHost['MuMuNxMain.exe'].match, 30, 'MuMuNxMain match=' + byHost['MuMuNxMain.exe'].match);
    assert.equal(byHost['MuMuNxService.exe'].match, 18, 'MuMuNxService match=' + byHost['MuMuNxService.exe'].match);
    assert.equal(byHost['MuMuRemoteService.exe'].match, 4, 'MuMuRemoteService match=' + byHost['MuMuRemoteService.exe'].match);
    for (const host of Object.keys(byHost)) {
      assert.equal(byHost[host].mismatch, 0, host + ' has ' + byHost[host].mismatch + ' mismatches');
    }
    return Object.keys(byHost).map((host) => host + '=' + byHost[host].match + '/' + byHost[host].total).join(' ');
  });

  await check('A2.3 the panel dry run is idempotent and writes nothing', async () => {
    const target = patchEngine.targetDllPath(detectedRoot);
    const before = patchEngine.sha256(fs.readFileSync(target));
    const state = await main.onPanelInvoke('mumu.patchDryRun', {});
    const after = patchEngine.sha256(fs.readFileSync(target));
    assert.equal(before, after, 'a dry run changed the file');
    assert.equal(state.patchResult.wrote, false, 'a dry run reported a write');
    assert.equal(state.patchResult.counts.applied, 0, 'a dry run wanted to apply ' + state.patchResult.counts.applied);
    assert.equal(state.patchResult.counts.already, 9, 'already=' + state.patchResult.counts.already);
    return 'already=9/9, sha unchanged (' + before.slice(0, 12) + ')';
  });

  await check('A2.2 the guard log carries the runtime summary lines', async () => {
    const state = await main.onPanelInvoke('mumu.guardLog', {});
    const summary = (state.guardLog && state.guardLog.lastSummary) || [];
    assert.ok(summary.length > 0, 'the guard log has no summary line');
    const text = summary.join(' | ');
    assert.ok(/applied=30/.test(text), 'no applied=30 line: ' + text);
    assert.ok(/applied=18/.test(text), 'no applied=18 line: ' + text);
    return text.replace(/\s+/g, ' ').slice(0, 140);
  });

  // --- AC-4 -----------------------------------------------------------------
  await check('A4.2 the manifest carries every required field and a two-locale title', async () => {
    for (const key of ['schemaVersion', 'id', 'name', 'version', 'description', 'main', 'ui', 'contributes', 'activationEvents', 'i18n', 'safetyNotes', 'permissions', 'author', 'license']) {
      assert.ok(MANIFEST[key] !== undefined, 'manifest is missing ' + key);
    }
    assert.equal(MANIFEST.schemaVersion, 1);
    assert.equal(MANIFEST.id, 'hawchou.mumu-player');
    assert.equal(MANIFEST.ui.panel, 'renderer/index.html');
    for (const locale of ['en', 'zh-CN']) {
      assert.ok(MANIFEST.ui.title[locale] && MANIFEST.ui.title[locale].trim(), 'ui.title.' + locale + ' is empty');
      for (const field of ['name', 'description', 'safetyNotes']) {
        assert.ok(MANIFEST.i18n[locale][field] && MANIFEST.i18n[locale][field].trim(), 'i18n.' + locale + '.' + field + ' is empty');
      }
    }
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, MANIFEST.main)), 'main entry is missing');
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, MANIFEST.ui.panel)), 'panel entry is missing');
    return MANIFEST.id + ' v' + MANIFEST.version + ', title ' + MANIFEST.ui.title.en + ' / ' + MANIFEST.ui.title['zh-CN'];
  });

  await check('A4.3 the two copy tables agree on keys, and the panel injects with textContent', async () => {
    const copy = require('../renderer/copy.js');
    const en = Object.keys(copy.COPY.en).sort();
    const zh = Object.keys(copy.COPY['zh-CN']).sort();
    assert.deepEqual(zh, en, 'the locale tables disagree');
    for (const key of en) {
      const left = (copy.COPY.en[key].match(/\{[a-zA-Z_][\w]*\}/g) || []).sort();
      const right = (copy.COPY['zh-CN'][key].match(/\{[a-zA-Z_][\w]*\}/g) || []).sort();
      assert.deepEqual(right, left, 'placeholder mismatch in ' + key);
    }
    const panel = fs.readFileSync(path.join(PLUGIN_ROOT, 'renderer', 'panel.js'), 'utf8');
    assert.ok(!/(\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\()/.test(panel), 'the panel assigns HTML instead of textContent');
    const html = fs.readFileSync(path.join(PLUGIN_ROOT, 'renderer', 'index.html'), 'utf8');
    const textNodes = (html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').match(/>([^<>]+)</g) || [])
      .map((node) => node.slice(1, -1).trim())
      .filter((node) => node.length > 1 && /[A-Za-z\u4e00-\u9fff]/.test(node));
    const dictionary = new Set(copy.allValuesForDictionary());
    const strays = textNodes.filter((node) => !dictionary.has(node));
    assert.equal(strays.length, 0, 'visible text outside the copy table: ' + strays.join(' | '));
    return en.length + ' keys, ' + textNodes.length + ' html text nodes all from the copy table';
  });

  await check('A4.4 the plugin is installed and registered for the host', async () => {
    const installed = path.join(os.homedir(), '.pi-desktop', 'plugins', 'installed', 'hawchou.mumu-player');
    assert.ok(fs.existsSync(path.join(installed, 'manifest.json')), 'installed manifest missing');
    assert.ok(fs.existsSync(path.join(installed, 'main.js')), 'installed main.js missing');
    const registryPath = path.join(os.homedir(), '.pi-desktop', 'plugins', 'registry.json');
    const registryList = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const entry = registryList.find((item) => item.id === 'hawchou.mumu-player');
    assert.ok(entry, 'no registry entry');
    assert.equal(entry.enabled, true);
    assert.equal(entry.status, 'ready');
    assert.equal(entry.path, installed);
    assert.deepEqual(entry.capabilities, ['panel', 'commands', 'tools']);
    return 'registered as source=' + entry.source + ', capabilities=' + entry.capabilities.join('+');
  });

  // --- unload ---------------------------------------------------------------
  await check('L3 onUnload unregisters everything it registered', async () => {
    await main.onUnload();
    assert.equal(registry.commands.size, 0, 'a command survived unload');
    assert.equal(registry.tools.size, 0, registry.tools.size + ' tools survived unload');
    return '0 commands, 0 tools';
  });

  lines.push('');
  lines.push(failures === 0
    ? 'ALL PASS  ' + lines.filter((line) => line.startsWith('PASS')).length + ' checks'
    : failures + ' CHECK(S) FAILED');
  process.stdout.write(lines.join('\n') + '\n');
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write('HARNESS FAILURE  ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
