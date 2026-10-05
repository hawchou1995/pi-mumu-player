'use strict';

// Single source of truth for every visible string in the panel. The two locale
// tables must carry the same keys and the same placeholder names; the panel
// never writes copy of its own, it only fills these values in with textContent.

const COPY = {
  en: {
    title: 'MuMu Player Toolkit',
    lede: 'Locate the emulator, drive MuMuManager, and keep the winhttp VIP patch table in sync with the installed build.',
    envHeading: 'Environment',
    envRoot: 'Install root',
    envSource: 'Resolved from',
    envManager: 'MuMuManager',
    envManual: 'Manual root',
    envManualHint: 'Absolute path to the folder that contains nx_main. Leave empty to use automatic detection.',
    btnRedetect: 'Detect again',
    btnSave: 'Save root',
    btnClear: 'Clear override',
    instHeading: 'Instances',
    instEmpty: 'No instance reported.',
    colIndex: 'Index',
    colName: 'Name',
    colState: 'State',
    colAndroid: 'Android',
    colAdb: 'adb',
    stateRunning: 'running',
    stateStopped: 'stopped',
    btnLaunch: 'Launch',
    btnShutdown: 'Shut down',
    btnRestart: 'Restart',
    patchHeading: 'VIP patch',
    patchTarget: 'Target file',
    patchState: 'State',
    patchDetected: 'Detected',
    patchNotDetected: 'Not detected',
    patchSource: 'Table',
    patchTable: 'File points',
    patchRuntime: 'Runtime points',
    btnDryRun: 'Dry run',
    btnApply: 'Apply patch',
    btnRestore: 'Restore backup',
    patchNoWrite: 'Nothing was written.',
    patchWrote: 'File written.',
    patchBackup: 'Backup',
    patchRefused: 'Refused',
    pointApplied: 'applied',
    pointAlready: 'already',
    pointMismatch: 'mismatch',
    pointSkipped: 'skipped',
    pointGone: 'gone',
    pointMatch: 'match',
    pointLegacy: 'legacy',
    stateAbsent: 'no file',
    stateNotProxy: 'not the proxy',
    stateLegacy: 'proxy, table from the earlier build',
    stateCorrected: 'proxy, table matches this build',
    stateUnknown: 'proxy, state unclear',
    cmdHeading: 'Command surface',
    cmdSubcommand: 'Subcommand',
    cmdArgs: 'Arguments',
    cmdArgsHint: 'Passed through unchanged, for example -v 0 launch',
    btnRun: 'Run',
    btnHelp: 'Help',
    cmdHelp: 'Verbatim help',
    cmdEmpty: 'No entry matches.',
    recoveryHeading: 'Dead guest recovery',
    recoveryLede: 'Use this when the guest Android framework has died: screencap hangs and dumpsys reports a missing window service. It terminates the instance and its VM helpers, waits for a clean stop, launches again, and waits for the activity service.',
    btnRecover: 'Recover instance',
    recoverHint: 'This terminates emulator processes. Uncommitted guest state is lost.',
    outputHeading: 'Output',
    outputEmpty: 'Nothing yet. Actions land here.',
    notFoundLede: 'No MuMu installation was found. Set the manual root below, or install MuMu and detect again.',
    srcManual: 'manual override',
    srcProcess: 'running process',
    srcRegistry: 'uninstall registry entry',
    srcCommonPath: 'well-known path',
    srcNone: 'not resolved',
    liveTitle: 'Enable live controls',
    liveHint: 'Off by default: the panel only reads. Turn it on to launch, patch and run commands from here.',
    footer: 'Writes are always preceded by a backup, and a point whose original bytes do not match is skipped instead of forced.',
  },
  'zh-CN': {
    title: 'MuMu 模拟器工具箱',
    lede: '定位模拟器安装目录，驱动 MuMuManager 的完整指令面，并让 winhttp 的 VIP 补丁点位表与已安装的版本保持一致。',
    envHeading: '环境',
    envRoot: '安装根目录',
    envSource: '解析来源',
    envManager: 'MuMuManager',
    envManual: '手工指定根目录',
    envManualHint: '填包含 nx_main 的那个文件夹的绝对路径。留空则使用自动探测。',
    btnRedetect: '重新探测',
    btnSave: '保存根目录',
    btnClear: '清除手工指定',
    instHeading: '实例',
    instEmpty: '没有读到实例。',
    colIndex: '序号',
    colName: '名称',
    colState: '状态',
    colAndroid: '安卓版本',
    colAdb: 'adb',
    stateRunning: '运行中',
    stateStopped: '已停止',
    btnLaunch: '启动',
    btnShutdown: '关机',
    btnRestart: '重启',
    patchHeading: 'VIP 补丁',
    patchTarget: '目标文件',
    patchState: '状态',
    patchDetected: '已检出',
    patchNotDetected: '未检出',
    patchSource: '点位表',
    patchTable: '文件点位',
    patchRuntime: '运行时点位',
    btnDryRun: '干跑',
    btnApply: '打补丁',
    btnRestore: '还原备份',
    patchNoWrite: '没有写入任何字节。',
    patchWrote: '文件已写入。',
    patchBackup: '备份',
    patchRefused: '已拒绝',
    pointApplied: '待写入',
    pointAlready: '已是最新',
    pointMismatch: '不匹配',
    pointSkipped: '跳过',
    pointGone: '越界',
    pointMatch: '匹配',
    pointLegacy: '旧版字节',
    stateAbsent: '文件不存在',
    stateNotProxy: '不是代理文件',
    stateLegacy: '是代理，但点位表来自旧版本',
    stateCorrected: '是代理，点位表与本版本一致',
    stateUnknown: '是代理，状态不明确',
    cmdHeading: '指令面',
    cmdSubcommand: '子命令',
    cmdArgs: '参数',
    cmdArgsHint: '原样透传，例如 -v 0 launch',
    btnRun: '执行',
    btnHelp: '查看帮助',
    cmdHelp: '帮助原文',
    cmdEmpty: '没有匹配的条目。',
    recoveryHeading: '半死 guest 恢复',
    recoveryLede: '当 guest 的安卓框架已经死掉时使用：screencap 挂死、dumpsys 报找不到 window 服务。它会终止实例与其 VM 辅助进程，等实例真正停下，再重新拉起，并等待 activity 服务应答。',
    btnRecover: '恢复实例',
    recoverHint: '这会终止模拟器进程，guest 内未提交的状态会丢失。',
    outputHeading: '输出',
    outputEmpty: '还没有输出。操作结果会落在这里。',
    notFoundLede: '没有找到 MuMu 安装。请在下面手工指定根目录，或先安装 MuMu 再重新探测。',
    srcManual: '手工指定',
    srcProcess: '运行中的进程',
    srcRegistry: '卸载注册表项',
    srcCommonPath: '常见路径',
    srcNone: '未解析出',
    liveTitle: '开启操作权限',
    liveHint: '默认关闭：面板只读。打开后才能在这里启动实例、打补丁、执行命令。',
    footer: '每次写入前都会先落备份；原始字节不匹配的点位一律跳过，绝不强行覆写。',
  },
};

const PLACEHOLDER = /\{([a-zA-Z_][\w]*)\}/g;

function fill(template, values) {
  if (typeof template !== 'string') return '';
  return template.replace(PLACEHOLDER, (whole, name) => (
    Object.prototype.hasOwnProperty.call(values || {}, name) ? String(values[name]) : whole
  ));
}

function pick(locale) {
  const wanted = String(locale || '').toLowerCase();
  if (wanted.startsWith('zh')) return COPY['zh-CN'];
  return COPY.en;
}

// A no-argument helper: every label is looked up here, never typed in the HTML.
function makeTranslator(locale) {
  const table = pick(locale);
  return (key, values) => {
    const template = table[key];
    if (template === undefined) return key;
    return values ? fill(template, values) : template;
  };
}

function allValuesForDictionary() {
  const out = new Set();
  for (const table of [COPY.en, COPY['zh-CN']]) {
    for (const value of Object.values(table)) out.add(value);
  }
  return out;
}

if (typeof window !== 'undefined') {
  window.mumuCopy = { COPY, makeTranslator, fill, allValuesForDictionary };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COPY, makeTranslator, fill, allValuesForDictionary };
}
