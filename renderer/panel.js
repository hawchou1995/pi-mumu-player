'use strict';

// Panel front end. Every visible string comes from copy.js; nothing is typed in
// here and nothing is injected with innerHTML.

const dom = (id) => document.getElementById(id);

let t = (key) => key;
let lastState = null;

function bridge() {
  if (!window.pluginBridge || typeof window.pluginBridge.invoke !== 'function') {
    throw new Error('pluginBridge unavailable');
  }
  return window.pluginBridge;
}

async function invoke(channel, payload) {
  return bridge().invoke(channel, payload || {});
}

function setText(id, value) {
  const node = dom(id);
  if (node) node.textContent = value === undefined || value === null ? '' : String(value);
}

function setHidden(id, hidden) {
  const node = dom(id);
  if (node) node.hidden = Boolean(hidden);
}

function output(text) {
  const node = dom('output');
  if (!node) return;
  node.textContent = String(text || '');
  setHidden('outputEmpty', Boolean(text));
}

function logLine(label, value) {
  const stamp = new Date().toLocaleTimeString();
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  output(`[${stamp}] ${label}\n${body}`);
}

const READ_ONLY_BUTTONS = new Set(['btnRedetect', 'btnDryRun', 'btnHelp', 'btnClear']);

function liveEnabled() {
  const node = dom('liveControls');
  return Boolean(node && node.checked);
}

function syncGating() {
  const live = liveEnabled();
  for (const button of document.querySelectorAll('button')) {
    if (READ_ONLY_BUTTONS.has(button.id)) continue;
    button.disabled = !live;
  }
}

function applyCopy() {
  setText('appTitle', t('title'));
  setText('lede', t('lede'));
  setText('liveTitle', t('liveTitle'));
  setText('liveHint', t('liveHint'));
  setText('notFoundLede', t('notFoundLede'));

  setText('envHeading', t('envHeading'));
  setText('envRootLabel', t('envRoot'));
  setText('envSourceLabel', t('envSource'));
  setText('envManagerLabel', t('envManager'));
  setText('envManualLabel', t('envManual'));
  setText('envManualHint', t('envManualHint'));
  setText('btnRedetect', t('btnRedetect'));
  setText('btnSave', t('btnSave'));
  setText('btnClear', t('btnClear'));

  setText('instHeading', t('instHeading'));
  setText('instEmpty', t('instEmpty'));
  setText('colIndex', t('colIndex'));
  setText('colName', t('colName'));
  setText('colState', t('colState'));
  setText('colAndroid', t('colAndroid'));
  setText('colAdb', t('colAdb'));

  setText('patchHeading', t('patchHeading'));
  setText('patchTargetLabel', t('patchTarget'));
  setText('patchStateLabel', t('patchState'));
  setText('patchSourceLabel', t('patchSource'));
  setText('patchTableLabel', t('patchTable'));
  setText('patchRuntimeLabel', t('patchRuntime'));
  setText('btnDryRun', t('btnDryRun'));
  setText('btnApply', t('btnApply'));
  setText('btnRestore', t('btnRestore'));

  setText('cmdHeading', t('cmdHeading'));
  setText('cmdSubcommandLabel', t('cmdSubcommand'));
  setText('cmdArgsLabel', t('cmdArgs'));
  setText('cmdArgsHint', t('cmdArgsHint'));
  setText('btnRun', t('btnRun'));
  setText('btnHelp', t('btnHelp'));

  setText('recoveryHeading', t('recoveryHeading'));
  setText('recoveryLede', t('recoveryLede'));
  setText('recoverHint', t('recoverHint'));
  setText('btnRecover', t('btnRecover'));

  setText('outputHeading', t('outputHeading'));
  setText('outputEmpty', t('outputEmpty'));
  setText('footer', t('footer'));
}

function sourceLabel(source) {
  switch (source) {
    case 'manual': return t('srcManual');
    case 'process': return t('srcProcess');
    case 'registry': return t('srcRegistry');
    case 'common-path': return t('srcCommonPath');
    default: return t('srcNone');
  }
}

function patchStateLabel(state) {
  switch (state) {
    case 'absent': return t('stateAbsent');
    case 'not-a-proxy': return t('stateNotProxy');
    case 'proxy-6.8.1-flavour': return t('stateLegacy');
    case 'proxy-6.8.2-corrected': return t('stateCorrected');
    default: return t('stateUnknown');
  }
}

function countLine(counts) {
  if (!counts) return '';
  return [
    `${t('pointApplied')}=${counts.applied || 0}`,
    `${t('pointAlready')}=${counts.already || 0}`,
    `${t('pointMismatch')}=${counts.mismatch || 0}`,
    `${t('pointSkipped')}=${counts.skipped || 0}`,
    `${t('pointGone')}=${counts.gone || 0}`,
    `/${counts.total || 0}`,
  ].join('  ');
}

function runtimeLine(hosts) {
  if (!Array.isArray(hosts) || !hosts.length) return '';
  return hosts
    .map((host) => `${host.host} ${t('pointMatch')}=${host.counts.match}/${host.counts.total}` +
      (host.counts.mismatch ? ` ${t('pointMismatch')}=${host.counts.mismatch}` : ''))
    .join('   ');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEnvironment(state) {
  const detection = state.detection || {};
  setHidden('notFound', Boolean(detection.found));
  setText('envRootValue', detection.found ? detection.root : '');
  setText('envSourceValue', detection.found ? sourceLabel(detection.source) : sourceLabel(null));
  setText('envManagerValue', detection.found
    ? `${detection.managerVersion || '?'}   ${detection.exe}`
    : '');
  setText('rootBadge', detection.found ? `${sourceLabel(detection.source)}: ${detection.root}` : t('srcNone'));
  const input = dom('manualRoot');
  if (input && document.activeElement !== input) input.value = state.settings.mumuRoot || '';
}

function renderInstances(state) {
  const body = dom('instBody');
  if (!body) return;
  body.textContent = '';
  const list = (state.instances && state.instances.instances) || [];
  setHidden('instEmpty', list.length > 0);
  for (const item of list) {
    const row = document.createElement('tr');

    const index = document.createElement('td');
    index.textContent = item.index === null ? '' : item.index;
    row.appendChild(index);

    const name = document.createElement('td');
    name.textContent = item.name || '';
    row.appendChild(name);

    const status = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = item.running ? 'dot on' : 'dot';
    status.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = item.running ? t('stateRunning') : t('stateStopped');
    status.appendChild(label);
    row.appendChild(status);

    const android = document.createElement('td');
    android.textContent = item.androidVersion || '';
    row.appendChild(android);

    const adb = document.createElement('td');
    adb.className = 'mono';
    adb.textContent = item.adbPort ? `${item.adbHost || ''}:${item.adbPort}` : '';
    row.appendChild(adb);

    const actions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    for (const action of [['launch', 'btnLaunch'], ['shutdown', 'btnShutdown'], ['restart', 'btnRestart']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action[0];
      button.dataset.index = item.index || '0';
      button.textContent = t(action[1]);
      button.className = action[0] === 'shutdown' ? 'danger' : '';
      button.disabled = !liveEnabled();
      button.addEventListener('click', () => runInstanceAction(action[0], item.index || '0'));
      wrap.appendChild(button);
    }
    actions.appendChild(wrap);
    row.appendChild(actions);
    body.appendChild(row);
  }
}

function renderPatch(state) {
  const patch = state.patch;
  if (!patch) {
    setText('patchTargetValue', '');
    setText('patchStateValue', '');
    setText('patchSourceValue', '');
    setText('patchTableValue', '');
    setText('patchRuntimeValue', '');
    return;
  }
  setText('patchTargetValue', `${patch.file.path}${patch.file.exists ? '' : `  (${t('patchNotDetected')})`}`);
  setText('patchStateValue', patchStateLabel(patch.file.state));
  setText('patchSourceValue', `${patch.table.schema}  ${patch.table.filePatchCount} + ${patch.table.pointCount}`);
  setText('patchTableValue', countLine(patch.file.counts));
  setText('patchRuntimeValue', runtimeLine(patch.runtime));
}

function renderCommands(state) {
  const select = dom('cmdSelect');
  if (!select || !state.commands) return;
  const previous = select.value;
  select.textContent = '';
  for (const entry of state.commands.entries) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = `${entry.name} — ${entry.summary}`;
    select.appendChild(option);
  }
  if (previous) select.value = previous;
}

function render(state) {
  lastState = state;
  const locale = state.locale || 'en';
  t = window.mumuCopy.makeTranslator(locale);
  applyCopy();
  renderEnvironment(state);
  renderInstances(state);
  renderPatch(state);
  renderCommands(state);
  syncGating();
  if (Array.isArray(state.errors) && state.errors.length) {
    const hint = dom('rootResult');
    if (hint) {
      hint.hidden = false;
      hint.className = 'hint bad';
      hint.textContent = state.errors.join('   ');
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function refresh(payload) {
  try {
    const state = await invoke('mumu.state', payload);
    render(state);
    return state;
  } catch (error) {
    logLine('state', String(error && error.message ? error.message : error));
    return null;
  }
}

async function runInstanceAction(action, index) {
  if (!liveEnabled()) return;
  try {
    const state = await invoke('mumu.action', { action, vmIndex: index });
    render(state);
    logLine(`control ${action} -v ${index}`, state.actionResult || state);
  } catch (error) {
    logLine(`control ${action}`, String(error && error.message ? error.message : error));
  }
}

function bind() {
  dom('liveControls').addEventListener('change', syncGating);

  dom('btnRedetect').addEventListener('click', async () => {
    const state = await invoke('mumu.detect', {});
    render(state);
    logLine('detect', state.detection || state);
  });

  dom('btnSave').addEventListener('click', async () => {
    const root = dom('manualRoot').value;
    const state = await invoke('mumu.setRoot', { root });
    render(state);
    const result = state.rootResult || {};
    const hint = dom('rootResult');
    if (hint) {
      hint.hidden = false;
      hint.className = result.ok ? 'hint good' : 'hint bad';
      hint.textContent = result.ok
        ? `${t('envRoot')}: ${result.root || state.detection.root || ''}`
        : `${result.reason || 'rejected'}: ${result.input || ''}${result.keptPrevious ? `  ${t('envRoot')}=${result.keptPrevious}` : ''}`;
    }
  });

  dom('btnClear').addEventListener('click', async () => {
    const state = await invoke('mumu.clearRoot', {});
    render(state);
    const hint = dom('rootResult');
    if (hint) {
      hint.className = 'hint';
      hint.textContent = sourceLabel(state.detection && state.detection.source);
    }
  });

  dom('btnDryRun').addEventListener('click', async () => {
    try {
      const state = await invoke('mumu.patchDryRun', {});
      render(state);
      logLine('patch dry run', state.patchResult || state);
    } catch (error) {
      logLine('patch dry run', String(error && error.message ? error.message : error));
    }
  });

  dom('btnApply').addEventListener('click', async () => {
    if (!liveEnabled()) return;
    const state = await invoke('mumu.patchApply', {});
    render(state);
    logLine('patch apply', state.patchResult || state);
    if (state.guardLog) logLine('guard log', state.guardLog);
  });

  dom('btnRestore').addEventListener('click', async () => {
    if (!liveEnabled()) return;
    const state = await invoke('mumu.patchRestore', {});
    render(state);
    logLine('patch restore', state.patchResult || state);
  });

  dom('btnRun').addEventListener('click', async () => {
    if (!liveEnabled()) return;
    const subcommand = dom('cmdSelect').value;
    const args = dom('cmdArgs').value;
    const state = await invoke('mumu.runManager', { subcommand, args });
    render(state);
    logLine(`MuMuManager ${subcommand} ${args}`.trim(), state.runResult || state);
  });

  dom('btnHelp').addEventListener('click', async () => {
    const subcommand = dom('cmdSelect').value;
    try {
      const result = await invoke('mumu.help', { subcommand });
      logLine(`help ${subcommand}`, (result.help && result.help.text) || result);
    } catch (error) {
      logLine(`help ${subcommand}`, String(error && error.message ? error.message : error));
    }
  });

  dom('btnRecover').addEventListener('click', async () => {
    if (!liveEnabled()) return;
    const index = (lastState && lastState.instances && lastState.instances.instances[0] && lastState.instances.instances[0].index) || '0';
    const state = await invoke('mumu.recover', { vmIndex: index, confirmed: true });
    render(state);
    logLine('recover', state.recoverResult || state);
  });
}

async function start() {
  window.pluginBridge && window.pluginBridge.on && window.pluginBridge.on('appearance:changed', (appearance) => {
    const base = appearance && appearance.base;
    document.documentElement.dataset.base = base === 'light' || base === 'dark'
      ? base
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  });
  try {
    const appearance = await invoke('app.getAppearance');
    const base = appearance && appearance.base;
    document.documentElement.dataset.base = base === 'light' || base === 'dark'
      ? base
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch {
    document.documentElement.dataset.base = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  let locale = 'en';
  try {
    const result = await invoke('mumu.getLocale');
    locale = (result && result.locale) || locale;
  } catch {
    locale = navigator.language || locale;
  }

  t = window.mumuCopy.makeTranslator(locale);
  applyCopy();
  bind();
  syncGating();
  output('');
  await refresh({});
}

document.addEventListener('DOMContentLoaded', start);
