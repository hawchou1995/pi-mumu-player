'use strict';

// Acceptance tests for the patch engine. Every destructive case runs against a
// copy inside a scratch root, so the real MuMu installation is only ever read.
//
//   node test/patch-core.test.js
//   node test/patch-core.test.js "D:\\Other\\MuMuPlayer"
//
// Covers: per-point classification, dry run, idempotence, mismatch refusal,
// byte-exact reproduction of the corrected file, restore.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const patch = require('../lib/patch');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REAL_ROOT = process.argv[2] || process.env.MUMU_ROOT || 'C:\\Program Files\\Netease\\MuMuPlayer';
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mumu-patch-test-'));

const lines = [];
let failures = 0;

function ok(name, detail) {
  lines.push(`PASS  ${name}${detail ? '  ' + detail : ''}`);
}

function bad(name, error) {
  failures += 1;
  lines.push(`FAIL  ${name}  ${error instanceof Error ? error.message : String(error)}`);
}

function check(name, fn) {
  try {
    const detail = fn();
    ok(name, detail);
  } catch (error) {
    bad(name, error);
  }
}

function layout(scratch, dllBytes) {
  const root = path.join(scratch, 'nx_main');
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, 'winhttp.dll');
  fs.writeFileSync(target, dllBytes);
  return { root: path.dirname(root), target };
}

// Revert the corrected bytes back to the legacy originals, producing the
// 6.8.1-flavoured file the table is supposed to repair.
function toLegacy(corrected, table) {
  const buffer = Buffer.from(corrected);
  for (const entry of table.patches) {
    const offset = Number.parseInt(String(entry.targetFileOffset).replace(/^0x/i, ''), 16);
    Buffer.from(entry.orig, 'hex').copy(buffer, offset);
  }
  return buffer;
}

// Corrupt every original window so nothing can match.
function toTampered(corrected, table) {
  const buffer = Buffer.from(corrected);
  for (const entry of table.patches) {
    const offset = Number.parseInt(String(entry.targetFileOffset).replace(/^0x/i, ''), 16);
    for (let i = 0; i < 5; i += 1) buffer[offset + i] = 0x00;
  }
  return buffer;
}

const table = patch.readTables(PLUGIN_ROOT);
lines.push(`plugin  ${PLUGIN_ROOT}`);
lines.push(`table   ${table.filePatchCount} file patches, ${table.pointCount} runtime points`);
lines.push(`real    ${REAL_ROOT}`);
lines.push(`scratch ${TMP_ROOT}`);
lines.push('');

const realTarget = path.join(REAL_ROOT, 'nx_main', 'winhttp.dll');
const realBytes = fs.existsSync(realTarget) ? fs.readFileSync(realTarget) : null;

// --- T1: classify the installed file -------------------------------------
check('T1 installed file classifies as corrected with every point already applied', () => {
  assert.ok(realBytes, `the installed proxy is missing at ${realTarget}`);
  const info = patch.inspectFile(realTarget, table);
  assert.equal(info.state, patch.STATE.CORRECTED, `state was ${info.state}`);
  assert.equal(info.counts.already, table.filePatchCount, `already=${info.counts.already}`);
  assert.equal(info.counts.mismatch, 0, `mismatch=${info.counts.mismatch}`);
  assert.equal(info.counts.applied, 0, `applied=${info.counts.applied}`);
  return `${info.sha256.slice(0, 16)} already=${info.counts.already}/${info.counts.total}`;
});

// --- T2: dry run writes nothing -------------------------------------------
check('T2 dry run on the installed file reports already and writes nothing', () => {
  const before = patch.sha256(fs.readFileSync(realTarget));
  const report = patch.applyFile(realTarget, table, { dryRun: true });
  const after = patch.sha256(fs.readFileSync(realTarget));
  assert.equal(report.wrote, false, 'dry run wrote the file');
  assert.equal(report.counts.applied, 0, `applied=${report.counts.applied}`);
  assert.equal(report.counts.already, table.filePatchCount, `already=${report.counts.already}`);
  assert.equal(before, after, 'sha256 changed during a dry run');
  return `already=${report.counts.already}/${report.counts.total} sha unchanged`;
});

// --- T3: runtime point table verifies against the executables -------------
check('T3 runtime points verify against the three target executables', () => {
  const hosts = patch.verifyRuntime(REAL_ROOT, table);
  const byHost = Object.fromEntries(hosts.map((h) => [h.host, h.counts]));
  const main = byHost['MuMuNxMain.exe'];
  const service = byHost['MuMuNxService.exe'];
  assert.ok(main, 'MuMuNxMain.exe was not verified at all');
  assert.ok(service, 'MuMuNxService.exe was not verified at all');
  assert.equal(main.match, 30, `MuMuNxMain match=${main.match}`);
  assert.equal(main.mismatch, 0, `MuMuNxMain mismatch=${main.mismatch}`);
  assert.equal(service.match, 18, `MuMuNxService match=${service.match}`);
  assert.equal(service.mismatch, 0, `MuMuNxService mismatch=${service.mismatch}`);
  const summary = hosts.map((h) => `${h.host}=${h.counts.match}/${h.counts.total}${h.counts.mismatch ? ' mismatch=' + h.counts.mismatch : ''}`).join(' ');
  return summary;
});

// --- T8: the PE parser agrees with the recorded file offsets ---------------
check('T8 every recorded file offset matches a parsed PE section table', () => {
  const byHost = new Map();
  for (const point of table.points) {
    if (!byHost.has(point.host)) byHost.set(point.host, []);
    byHost.get(point.host).push(point);
  }
  let checked = 0;
  const problems = [];
  for (const entry of byHost) {
    const host = entry[0];
    const points = entry[1];
    const filePath = path.join(REAL_ROOT, 'nx_main', host);
    if (!fs.existsSync(filePath)) {
      problems.push(host + ': file missing');
      continue;
    }
    const sections = patch.readPeSections(fs.readFileSync(filePath));
    if (!sections) {
      problems.push(host + ': not a PE image');
      continue;
    }
    for (const point of points) {
      const rva = Number.parseInt(String(point.rva).replace(/^0x/i, ''), 16);
      const want = Number.parseInt(String(point.fileOffset).replace(/^0x/i, ''), 16);
      const got = patch.rvaToOffset(sections, rva);
      checked += 1;
      if (got !== want) {
        const shown = got === null ? 'null' : '0x' + got.toString(16).toUpperCase();
        problems.push(point.id + ': recorded 0x' + want.toString(16).toUpperCase() + ' derived ' + shown);
      }
    }
  }
  assert.equal(problems.length, 0, problems.slice(0, 3).join(' | '));
  assert.equal(checked, table.pointCount, 'checked ' + checked + ' of ' + table.pointCount);
  return checked + ' recorded offsets agree with the parsed section table';
});

// --- T4: legacy file is repaired to the exact corrected bytes --------------
check('T4 a legacy-flavoured copy is repaired to the exact corrected sha256', () => {
  assert.ok(realBytes, 'no installed proxy to derive test material from');
  const legacyBytes = toLegacy(realBytes, table);
  const legacySha = patch.sha256(legacyBytes);
  assert.notEqual(legacySha, patch.sha256(realBytes), 'the legacy copy is identical to the corrected file');

  const scratch = fs.mkdtempSync(path.join(TMP_ROOT, 'legacy-'));
  const { root, target } = layout(scratch, legacyBytes);

  const before = patch.inspectFile(target, table);
  assert.equal(before.state, patch.STATE.LEGACY, `state was ${before.state}`);
  assert.equal(before.counts.applied, table.filePatchCount, `applied=${before.counts.applied}`);

  const report = patch.applyFile(target, table, { keepBackups: true });
  assert.equal(report.wrote, true, 'the repair did not write');
  assert.equal(report.counts.applied, table.filePatchCount, `applied=${report.counts.applied}`);
  assert.equal(report.sha256Before, legacySha, 'sha256Before does not match the legacy copy');
  assert.equal(report.sha256After, patch.sha256(realBytes), 'the repaired file is not byte-identical to the corrected one');
  assert.ok(report.backup && fs.existsSync(report.backup), 'no backup was written');
  assert.equal(patch.sha256(fs.readFileSync(report.backup)), legacySha, 'the backup is not the pre-patch file');
  assert.ok(report.audit && fs.existsSync(report.audit), 'no audit record was written');

  const recheck = patch.inspectFile(target, table);
  assert.equal(recheck.state, patch.STATE.CORRECTED, `after repair the state is ${recheck.state}`);
  assert.equal(recheck.counts.already, table.filePatchCount, `after repair already=${recheck.counts.already}`);

  // keep the repaired root for T6/T7
  fs.writeFileSync(path.join(scratch, 'sha.txt'), legacySha, 'utf8');
  return `legacy ${legacySha.slice(0, 12)} to ${report.sha256After.slice(0, 12)}`;
});

// --- T5: tampered file is refused ----------------------------------------
check('T5 a tampered file reports mismatch and is left byte-identical', () => {
  assert.ok(realBytes, 'no installed proxy to derive test material from');
  const tampered = toTampered(realBytes, table);
  const scratch = fs.mkdtempSync(path.join(TMP_ROOT, 'tampered-'));
  const { target } = layout(scratch, tampered);
  const before = patch.sha256(fs.readFileSync(target));
  const report = patch.applyFile(target, table, {});
  const after = patch.sha256(fs.readFileSync(target));
  assert.equal(report.wrote, false, 'a tampered file was written');
  assert.equal(report.counts.mismatch, table.filePatchCount, `mismatch=${report.counts.mismatch}`);
  assert.equal(report.counts.applied, 0, `applied=${report.counts.applied}`);
  assert.ok(report.refused, 'no refusal reason was reported');
  assert.equal(before, after, 'sha256 changed on a refused patch');
  return `mismatch=${report.counts.mismatch}/${report.counts.total} refused, sha unchanged`;
});

// --- T6: idempotence ------------------------------------------------------
check('T6 applying twice is idempotent', () => {
  const dirs = fs.readdirSync(TMP_ROOT).filter((name) => name.startsWith('legacy-'));
  assert.ok(dirs.length, 'T4 did not leave a repaired root behind');
  const target = path.join(TMP_ROOT, dirs[0], 'nx_main', 'winhttp.dll');
  const before = patch.sha256(fs.readFileSync(target));
  const report = patch.applyFile(target, table, {});
  const after = patch.sha256(fs.readFileSync(target));
  assert.equal(report.wrote, false, 'the second apply wrote again');
  assert.equal(report.counts.already, table.filePatchCount, `already=${report.counts.already}`);
  assert.equal(report.counts.applied, 0, `applied=${report.counts.applied}`);
  assert.equal(before, after, 'sha256 changed on an idempotent run');
  return `already=${report.counts.already}/${report.counts.total} sha unchanged`;
});

// --- T7: restore ----------------------------------------------------------
check('T7 restore returns the file to the legacy sha256 it came from', () => {
  const dirs = fs.readdirSync(TMP_ROOT).filter((name) => name.startsWith('legacy-'));
  assert.ok(dirs.length, 'T4 did not leave a repaired root behind');
  const dir = path.join(TMP_ROOT, dirs[0]);
  const target = path.join(dir, 'nx_main', 'winhttp.dll');
  const legacySha = fs.readFileSync(path.join(dir, 'sha.txt'), 'utf8').trim();
  const report = patch.restoreFile(target, null, {});
  assert.equal(report.wrote, true, 'restore did not write');
  assert.equal(report.sha256After, legacySha, 'restored sha256 does not match the legacy original');
  assert.ok(report.restoredFrom, 'no source backup was named');
  const recheck = patch.inspectFile(target, table);
  assert.equal(recheck.state, patch.STATE.LEGACY, `after restore the state is ${recheck.state}`);
  return `restored ${report.sha256After.slice(0, 12)}`;
});

lines.push('');
lines.push(failures === 0 ? `ALL PASS  ${lines.filter((line) => line.startsWith('PASS')).length} checks` : `${failures} CHECK(S) FAILED`);
process.stdout.write(lines.join('\n') + '\n');
try {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
} catch {
  /* scratch cleanup is best effort */
}
process.exit(failures === 0 ? 0 : 1);
