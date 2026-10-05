'use strict';

// Proof that the runtime patch points actually land.
//
// The proxy writes nx_main\mumu_guard_winhttp.log every time it attaches to a
// host process. This records the log length, forces a fresh attach, waits for
// the guest to come back, and then reads ONLY the bytes appended since the
// boundary — so every summary line it finds comes from this run.
//
// Note on what "restart" has to mean here: the proxy attaches to MuMuNxMain and
// MuMuNxService, and both of those survive an instance restart. `control
// shutdown` only tears down the VM and MuMuNxDevice. A fresh attach therefore
// needs the main application restarted, which is what this does.
//
//   node tools/verify-guard-log.js                  restart the host and verify
//   node tools/verify-guard-log.js 1                instance 1
//   node tools/verify-guard-log.js 0 --no-restart   check the tail, do not restart

const fs = require('node:fs');
const path = require('node:path');

const mumu = require('../lib/mumu');

const args = process.argv.slice(2);
const vmIndex = args.find((value) => /^\d+$/.test(value)) || '0';
const noRestart = args.includes('--no-restart');
const ROOT = args.find((value) => /[\\/]/.test(value)) || process.env.MUMU_ROOT || 'C:\\Program Files\\Netease\\MuMuPlayer';
const LOG = path.join(ROOT, 'nx_main', 'mumu_guard_winhttp.log');

const EXPECTED = [
  { host: 'MuMuNxMain.exe', applied: 30, total: 30 },
  { host: 'MuMuNxService.exe', applied: 18, total: 18 },
];

let boundary = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function compact(result) {
  const text = (result.stdout + result.stderr).trim().replace(/\s+/g, ' ');
  return text || `exit ${result.code}`;
}

// Only the bytes appended after `boundary` count as evidence for this run.
function appended() {
  try {
    const buffer = fs.readFileSync(LOG);
    const start = Math.min(Math.max(0, boundary), buffer.length);
    return buffer.subarray(start).toString('utf8');
  } catch {
    return '';
  }
}

async function waitForHostAttach(budgetMs) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const text = appended();
    if (EXPECTED.every((want) => text.includes('host=' + want.host))) {
      return { ok: true, waited: Math.round((Date.now() - started) / 1000) };
    }
    await sleep(3000);
  }
  return { ok: false, waited: Math.round(budgetMs / 1000) };
}

async function waitForFramework() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(4000);
    const probe = mumu.runManager(ROOT, 'sh', ['-v', vmIndex, '-c', 'dumpsys -l'], 30000);
    if (/\bactivity\b/.test(probe.stdout + probe.stderr)) return { up: true, waited: (attempt + 1) * 4 };
  }
  return { up: false, waited: 240 };
}

async function main() {
  const out = [];
  out.push('root      ' + ROOT);
  out.push('log       ' + LOG);
  out.push('instance  ' + vmIndex);

  if (!fs.existsSync(LOG)) {
    out.push('FAIL  the guard log does not exist, so the proxy is not installed');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(1);
  }

  if (noRestart) {
    const size = fs.statSync(LOG).size;
    boundary = Math.max(0, size - 8192);
    out.push('boundary  restart skipped, reading the last ' + (size - boundary) + ' bytes');
  } else {
    boundary = fs.statSync(LOG).size;
    out.push('boundary  log was ' + boundary + ' bytes at ' + localStamp());

    const killed = mumu.runManager(ROOT, 'main', ['kill'], 120000);
    out.push('host      main kill -> ' + compact(killed));
    await sleep(8000);
    const relaunched = mumu.runManager(ROOT, 'main', ['launch'], 180000);
    out.push('host      main launch -> ' + compact(relaunched));

    const attached = await waitForHostAttach(120000);
    out.push('host      ' + (attached.ok
      ? 'the proxy attached to both targets after ' + attached.waited + 's'
      : 'no attach seen within ' + attached.waited + 's'));

    const instance = mumu.runManager(ROOT, 'control', ['-v', vmIndex, 'launch'], 180000);
    out.push('instance  control launch -> ' + compact(instance));

    const boot = await waitForFramework();
    out.push('framework ' + (boot.up
      ? 'the activity service answered after ' + boot.waited + 's'
      : 'never answered within ' + boot.waited + 's'));
    if (!boot.up) {
      out.push('FAIL  the guest framework did not come back, so the guard log proves nothing');
      process.stdout.write(out.join('\n') + '\n');
      process.exit(1);
    }
    await sleep(3000);
  }

  const text = appended();
  const lines = text.split(/\r?\n/);
  const hosts = lines.filter((line) => line.includes('host='));
  const summaries = lines.filter((line) => line.includes('summary:'));

  out.push('');
  out.push('bytes appended since the boundary: ' + Buffer.byteLength(text, 'utf8'));
  out.push('hosts seen: ' + (hosts.length
    ? hosts.map((line) => {
      const at = line.indexOf('[+] host=');
      return at >= 0 ? line.slice(at + 4).trim() : line.trim();
    }).join(' | ')
    : '(none)'));
  out.push('summaries:');
  if (summaries.length) {
    for (const line of summaries) out.push('  ' + line.trim());
  } else {
    out.push('  (none)');
  }
  out.push('');

  let failed = 0;
  for (const want of EXPECTED) {
    const hostLine = hosts.filter((line) => line.includes('host=' + want.host));
    if (!hostLine.length) {
      out.push('FAIL  ' + want.host + ' never attached, so the proxy did not touch it');
      failed += 1;
      continue;
    }
    out.push('PASS  ' + want.host + ' attached (' + hostLine[hostLine.length - 1].trim() + ')');
    const pattern = new RegExp('applied=' + want.applied + ' already=\\d+ mismatch=0 skipped=0 total=' + want.total);
    const match = summaries.find((line) => pattern.test(line));
    if (!match) {
      out.push('FAIL  ' + want.host + ' has no clean summary (want applied=' + want.applied + ' mismatch=0 total=' + want.total + ')');
      const bad = summaries.filter((line) => /mismatch=[1-9]/.test(line));
      if (bad.length) out.push('      offending summaries: ' + bad.map((line) => line.trim()).join(' | '));
      failed += 1;
      continue;
    }
    out.push('PASS  ' + want.host + ' summary is clean (' + match.trim() + ')');
  }

  const mismatching = summaries.filter((line) => /mismatch=[1-9]/.test(line));
  if (mismatching.length) {
    out.push('FAIL  ' + mismatching.length + ' summary line(s) report a mismatch');
    failed += 1;
  } else {
    out.push('PASS  no summary line in this window reports a mismatch');
  }

  out.push('');
  out.push(failed === 0 ? 'ALL PASS  the runtime points landed on every host' : failed + ' CHECK(S) FAILED');
  process.stdout.write(out.join('\n') + '\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stdout.write('HARNESS FAILURE  ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
