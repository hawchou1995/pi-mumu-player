'use strict';

// Publishes this plugin to the PI-Desktop plugin centre over MCP.
//
//   node tools/publish.js --check        verify readiness, publish nothing
//   node tools/publish.js                create the plugin or release the version
//   node tools/publish.js --repository hawchou1995/pi-mumu-player
//
// The token is read from ~/.pi-desktop/plugin-center.token and is never printed,
// never written anywhere else and never sent anywhere but the endpoint below.
// When that file is missing, run the device flow from
// https://plugins.aiuo.net/skill.md and save the token there yourself.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const ENDPOINT = new URL('https://plugins.aiuo.net/mcp');
const TOKEN_FILE = path.join(os.homedir(), '.pi-desktop', 'plugin-center.token');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const repoFlagIndex = args.indexOf('--repository');
const repositoryFlag = repoFlagIndex >= 0 ? args[repoFlagIndex + 1] : null;

const SKIP_DIRS = new Set(['.git', '.github', 'test', 'tests', 'node_modules']);
const SKIP_SUFFIXES = ['.piplug'];
const SKIP_NAMES = new Set(['.DS_Store']);

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const raw = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return raw || null;
}

// Minimal streamable-HTTP JSON-RPC client. The server answers with an SSE frame
// whose single `data:` line carries the JSON-RPC response.
function rpc(tool, toolArgs, token) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: toolArgs || {} },
  });
  const options = {
    hostname: ENDPOINT.hostname,
    port: ENDPOINT.port || 443,
    path: ENDPOINT.pathname,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        const match = /data:\s*(\{[\s\S]*\})/.exec(text);
        const payload = match ? match[1] : text;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          reject(new Error(`unparseable response: ${text.slice(0, 300)}`));
          return;
        }
        if (parsed.error) {
          reject(new Error(`jsonrpc error: ${JSON.stringify(parsed.error)}`));
          return;
        }
        const content = parsed.result && parsed.result.content;
        const first = Array.isArray(content) && content[0] ? content[0].text : '';
        let inner = null;
        try {
          inner = JSON.parse(first);
        } catch {
          inner = first;
        }
        resolve(inner);
      });
    });
    request.on('error', reject);
    request.setTimeout(90000, () => request.destroy(new Error('request timed out')));
    request.write(body);
    request.end();
  });
}

function collectFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (relative === 'manifest.json') continue;
      if (SKIP_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      files.push({ path: relative, content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function runGate() {
  const gate = path.join(PLUGIN_ROOT, 'tools', 'i18n-gate.py');
  if (!fs.existsSync(gate)) return { ran: false, code: null, output: 'tools/i18n-gate.py is missing' };
  const result = spawnSync('python', [gate], { cwd: PLUGIN_ROOT, encoding: 'utf8', timeout: 120000 });
  return { ran: true, code: result.status, output: ((result.stdout || '') + (result.stderr || '')).trim() };
}

function releaseNotes(manifest) {
  const file = path.join(PLUGIN_ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return `Release ${manifest.version}.`;
  const text = fs.readFileSync(file, 'utf8');
  const heading = text.indexOf('## ' + manifest.version);
  if (heading < 0) return `Release ${manifest.version}.`;
  const rest = text.slice(heading);
  const next = rest.indexOf('\n## ', 1);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

async function main() {
  const out = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'manifest.json'), 'utf8'));
  const readme = fs.existsSync(path.join(PLUGIN_ROOT, 'README.md'))
    ? fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8')
    : null;

  out.push('plugin      ' + manifest.id + ' v' + manifest.version);
  out.push('root        ' + PLUGIN_ROOT);

  const gate = runGate();
  out.push('i18n gate   ' + (gate.ran ? gate.output.split('\n')[0] : gate.output));
  if (gate.ran && gate.code !== 0) {
    out.push('FAIL  the i18n gate did not pass; fix the source, not the payload');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(1);
  }

  const files = collectFiles(PLUGIN_ROOT);
  out.push('files       ' + files.length + ' (' + files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) + ' bytes)');
  for (const file of files) out.push('            ' + file.path);

  const token = readToken();
  if (!token) {
    out.push('');
    out.push('FAIL  no token at ' + TOKEN_FILE);
    out.push('      run the device flow described at https://plugins.aiuo.net/skill.md,');
    out.push('      then save the token in that file (mode 0600). Do not paste it here.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(1);
  }
  out.push('token       read from the token file (not printed)');

  const who = await rpc('whoami', {}, token);
  out.push('account     ' + (who && who.username) + '  role=' + (who && who.role) + '  uploadsToday=' + (who && who.uploadsToday) + '/' + (who && who.uploadLimit));

  const mine = await rpc('list_plugins', {}, token);
  const existing = ((mine && mine.plugins) || []).find((entry) => entry.id === manifest.id);
  out.push('exists      ' + (existing ? 'yes (' + JSON.stringify(existing.versions || existing).slice(0, 120) + ')' : 'no'));

  let repository = repositoryFlag;
  if (!existing) {
    const repos = await rpc('list_repositories', {}, token);
    const coordinate = repository || ('hawchou1995/' + path.basename(PLUGIN_ROOT));
    const covered = ((repos && repos.repositories) || []).some((entry) => entry.coordinate === coordinate);
    out.push('repositories ' + ((repos && repos.repositories) || []).length + ' bindable');
    if (!covered) {
      out.push('');
      out.push('FAIL  ' + coordinate + ' is not in the bindable repository list.');
      out.push('      The GitHub App is scoped to selected repositories. Grant it access to');
      out.push('      ' + coordinate + ' once at https://github.com/settings/installations,');
      out.push('      then run this again. Do not bind the plugin to a different repository.');
      process.stdout.write(out.join('\n') + '\n');
      process.exit(1);
    }
    repository = coordinate;
    out.push('repository  ' + repository + ' is bindable');
  }

  const sourceRef = 'v' + manifest.version;
  const source = spawnSync('git', ['rev-parse', sourceRef], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
  if (source.status !== 0) {
    out.push('FAIL  git has no ' + sourceRef + '; commit, tag and push before publishing');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(1);
  }
  out.push('sourceRef   ' + sourceRef + ' -> ' + source.stdout.trim());

  if (checkOnly) {
    out.push('');
    out.push('CHECK ONLY  everything above is ready; nothing was published');
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  const shared = {
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    main: manifest.main,
    permissions: manifest.permissions,
    engines: manifest.engines,
    i18n: manifest.i18n,
    author: manifest.author,
    license: manifest.license,
    homepage: manifest.homepage,
    categories: manifest.categories,
    changelog: manifest.changelog,
    safetyNotes: manifest.safetyNotes,
    ui: manifest.ui,
    contributes: manifest.contributes,
    activationEvents: manifest.activationEvents,
    fs: manifest.fs,
    net: manifest.net,
    files: files.map((file) => ({ path: file.path, content: file.content })),
    sourceRef,
    releaseNotes: releaseNotes(manifest),
  };

  let result;
  if (existing) {
    out.push('action      submit_version');
    result = await rpc('submit_version', Object.assign({ pluginId: manifest.id }, shared), token);
  } else {
    out.push('action      create_plugin');
    result = await rpc('create_plugin', Object.assign({ id: manifest.id, repository, readme }, shared), token);
  }
  out.push('result      ' + JSON.stringify(result).slice(0, 600));

  const status = await rpc('plugin_status', { pluginId: manifest.id }, token);
  out.push('status      ' + JSON.stringify(status).slice(0, 900));
  out.push('');
  out.push('DONE  ' + manifest.id + ' v' + manifest.version + ' submitted. A version that is waiting');
  out.push('      for review is public to nobody until an operator accepts it. Do not resubmit.');
  process.stdout.write(out.join('\n') + '\n');
}

main().catch((error) => {
  process.stdout.write('FAIL  ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
