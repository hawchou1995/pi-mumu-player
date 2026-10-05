'use strict';

// Builds the command reference that ships inside the plugin.
//
//   node tools/build-command-reference.js
//   node tools/build-command-reference.js "D:\\Other\\MuMuPlayer" C:\\out
//
// Runs `MuMuManager <sub> -h` for every top-level subcommand plus every nested
// one, parses the output, and writes:
//   data/mumu-commands.json            machine-readable index
//   docs/MuMuManager-command-reference.md   human-readable reference
//
// The help text is captured live, never transcribed, so the reference can be
// regenerated after a MuMu upgrade.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const ROOT = process.argv[2] || process.env.MUMU_ROOT || 'C:\\Program Files\\Netease\\MuMuPlayer';
const OUT_DIR = process.argv[3] || PLUGIN_ROOT;
const MANAGER = path.join(ROOT, 'nx_main', 'MuMuManager.exe');

function helpFor(selection) {
  const parts = selection.split(' ').filter(Boolean).concat(['-h']);
  const result = spawnSync(MANAGER, parts, { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return ((result.stdout || '') + (result.stderr || '')).replace(/\r\n/g, '\n').trim();
}

function section(text, name) {
  const match = new RegExp('^' + name + ':', 'm').exec(text);
  if (!match) return '';
  const rest = text.slice(match.index + match[0].length);
  const nextHeader = rest.search(/^(OVERVIEW|USAGE|OPTIONS|ARGUMENTS|SUBCOMMANDS):/m);
  // Only trailing whitespace is dropped: the option and subcommand parsers
  // depend on the indentation of the first line of the block.
  return (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).replace(/\s+$/, '');
}

function firstLine(block) {
  const found = block.split('\n').map((line) => line.trim()).filter(Boolean);
  return found.length ? found[0] : '';
}

// An option entry starts at a line whose indentation is exactly two spaces and
// which begins with a flag; everything more indented belongs to that entry.
function parseOptions(block) {
  if (!block) return [];
  const lines = block.split('\n');
  const entries = [];
  let current = null;
  let inDiscussion = false;
  for (const line of lines) {
    const start = /^ {2}(-{1,2}[A-Za-z_][\w-]*(?:,\s*-{1,2}[A-Za-z_][\w-]*)?)(\s+<[^>]+>)?\s{2,}(.*)$/.exec(line);
    if (start) {
      if (current) entries.push(current);
      current = { flags: (start[1] + (start[2] || '')).trim(), text: [start[3].trim()] };
      inDiscussion = false;
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'Discussion:') {
      inDiscussion = true;
      continue;
    }
    // The prose under Discussion: is advisory; the flag line carries the meaning.
    if (inDiscussion) continue;
    current.text.push(trimmed);
  }
  if (current) entries.push(current);
  return entries.map((entry) => ({ flags: entry.flags, text: entry.text.join(' ') }));
}

function parseSubcommands(block) {
  if (!block) return [];
  const out = [];
  for (const line of block.split('\n')) {
    const match = /^ {2}([a-z_][\w-]*)\s{2,}(.*)$/.exec(line);
    if (match) out.push({ name: match[1], summary: match[2].trim() });
  }
  return out;
}

function parse(selection, text) {
  const overview = firstLine(section(text, 'OVERVIEW'));
  const usage = firstLine(section(text, 'USAGE'));
  const entry = {
    name: selection,
    summary: overview,
    usage,
    options: parseOptions(section(text, 'OPTIONS')),
    nested: parseSubcommands(section(text, 'SUBCOMMANDS')),
    help: text,
  };
  return entry;
}

const TOP_LEVEL = [
  'version', 'info', 'create', 'clone', 'upgrade', 'delete', 'rename',
  'import', 'export', 'control', 'setting', 'adb', 'simulation', 'sort',
  'driver', 'log', 'sh', 'main',
];

if (!fs.existsSync(MANAGER)) {
  process.stderr.write(`MuMuManager.exe not found at ${MANAGER}\n`);
  process.exit(1);
}

const versionResult = spawnSync(MANAGER, ['version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
const managerVersion = (() => {
  try {
    return JSON.parse((versionResult.stdout || '').trim()).version;
  } catch {
    return null;
  }
})();

const commands = [];
for (const name of TOP_LEVEL) {
  const text = helpFor(name);
  const entry = parse(name, text);
  commands.push(entry);
  for (const nested of entry.nested) {
    const nestedSelection = name + ' ' + nested.name;
    const nestedText = helpFor(nestedSelection);
    commands.push(parse(nestedSelection, nestedText));
  }
}

const doc = {
  schema: 'mumu-manager-commands/1',
  capturedFrom: MANAGER,
  managerVersion,
  topLevel: TOP_LEVEL,
  commandCount: commands.length,
  commands,
};

fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'docs'), { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'data', 'mumu-commands.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8');

const md = [];
md.push('# MuMuManager command reference');
md.push('');
md.push('Captured live from `' + MANAGER + '` — manager version `' + (managerVersion || 'unknown') + '`.');
md.push('');
md.push('Eighteen top-level subcommands, ' + commands.length + ' entries including nested ones. Regenerate after a MuMu upgrade with:');
md.push('');
md.push('```');
md.push('node tools/build-command-reference.js "<MuMu root>"');
md.push('```');
md.push('');
md.push('## Index');
md.push('');
md.push('| Subcommand | Summary | Nested |');
md.push('|---|---|---|');
for (const entry of commands.filter((item) => TOP_LEVEL.includes(item.name))) {
  md.push('| `' + entry.name + '` | ' + entry.summary + ' | ' + (entry.nested.map((nested) => '`' + nested.name + '`').join(', ') || '—') + ' |');
}
md.push('');
for (const entry of commands) {
  md.push('## `MuMuManager ' + entry.name + '`');
  md.push('');
  md.push(entry.summary);
  md.push('');
  md.push('```');
  md.push(entry.help);
  md.push('```');
  md.push('');
}
fs.writeFileSync(path.join(OUT_DIR, 'docs', 'MuMuManager-command-reference.md'), md.join('\n'), 'utf8');

process.stdout.write(
  [
    'root            ' + ROOT,
    'manager version ' + (managerVersion || 'unknown'),
    'entries         ' + commands.length + ' (' + TOP_LEVEL.length + ' top-level)',
    'wrote           ' + path.join(OUT_DIR, 'data', 'mumu-commands.json'),
    'wrote           ' + path.join(OUT_DIR, 'docs', 'MuMuManager-command-reference.md'),
  ].join('\n') + '\n',
);
