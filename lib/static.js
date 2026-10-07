// Static patcher for the MuMu client executables.
//
// The winhttp proxy applies the fifty-two runtime points *in memory*, which means
// the operator has to supply that proxy DLL first. This module applies the very
// same points to the *on-disk* binaries instead, so the patch works without any
// proxy at all.
//
// Behaviour mirrors lib/patch.js:
//   * every point is located by the RVA recorded in patch/points.json, converted to
//     a file offset through the parsed PE section table
//   * a point is written only when the bytes at that offset still equal `orig`
//   * a point whose `orig` is longer than its `patch` is a stub: the leading
//     `patch` bytes are written and the remainder of the original function body is
//     filled with NOPs, so the file size and every other offset stay intact
//   * every file is backed up before it is touched, with a JSON audit record beside
//     the backup, and the whole run is reversible with restore()

const fs = require('node:fs');
const path = require('node:path');

const POINT_STATE = {
  MATCH: 'match',
  ALREADY: 'already',
  LEGACY: 'legacy',
  MISMATCH: 'mismatch',
  GONE: 'gone',
};

const NOP = 0x90;

function readPoints(pluginRoot) {
  const file = path.join(pluginRoot, 'patch', 'points.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, doc, points: Array.isArray(doc.points) ? doc.points : [] };
}

function parseRva(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number.parseInt(value.replace(/^0x/i, ''), 16);
  return Number.isNaN(parsed) ? null : parsed;
}

function hex(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('hex');
}

// Minimal PE section table reader: enough to turn an RVA into a file offset.
function peSections(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null;
  const peOff = buffer.readUInt32LE(0x3c);
  if (peOff + 24 > buffer.length || buffer.readUInt32LE(peOff) !== 0x00004550) return null;
  const sectionCount = buffer.readUInt16LE(peOff + 6);
  const optSize = buffer.readUInt16LE(peOff + 20);
  const tableAt = peOff + 24 + optSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const at = tableAt + i * 40;
    if (at + 40 > buffer.length) break;
    sections.push({
      name: buffer.subarray(at, at + 8).toString('ascii').replace(/\0.*$/, ''),
      virtualSize: buffer.readUInt32LE(at + 8),
      virtualAddress: buffer.readUInt32LE(at + 12),
      rawSize: buffer.readUInt32LE(at + 16),
      rawPointer: buffer.readUInt32LE(at + 20),
    });
  }
  return sections;
}

function rvaToOffset(sections, rva) {
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }
  return null;
}

function hostPath(root, host) {
  return path.join(root, 'nx_main', host);
}

// Classify every point of one host without writing anything.
function scanHost(root, host, points) {
  const file = hostPath(root, host);
  const entry = {
    host,
    path: file,
    exists: fs.existsSync(file),
    size: 0,
    counts: { match: 0, already: 0, legacy: 0, mismatch: 0, gone: 0, total: points.length },
    mismatches: [],
    applyable: [],
  };
  if (!entry.exists) {
    entry.counts.gone = points.length;
    return entry;
  }
  const buffer = fs.readFileSync(file);
  entry.size = buffer.length;
  const sections = peSections(buffer);
  if (!sections) {
    entry.counts.gone = points.length;
    entry.note = 'not a PE image';
    return entry;
  }

  for (const point of points) {
    const rva = parseRva(point.rva);
    const offset = rva === null ? null : rvaToOffset(sections, rva);
    if (offset === null || offset + point.orig.length / 2 > buffer.length) {
      entry.counts[POINT_STATE.GONE] += 1;
      continue;
    }
    const orig = Buffer.from(point.orig, 'hex');
    const patch = Buffer.from(point.patch, 'hex');
    const current = buffer.subarray(offset, offset + orig.length);
    const state = current.equals(orig)
      ? POINT_STATE.MATCH
      : current.subarray(0, patch.length).equals(patch)
        ? POINT_STATE.ALREADY
        : point.origLegacy && current.equals(Buffer.from(point.origLegacy, 'hex'))
          ? POINT_STATE.LEGACY
          : POINT_STATE.MISMATCH;
    entry.counts[state] += 1;
    if (state === POINT_STATE.MISMATCH) {
      entry.mismatches.push({ id: point.id, rva: point.rva, offset, expected: point.orig });
    }
    if (state === POINT_STATE.MATCH) {
      entry.applyable.push({
        id: point.id,
        offset,
        orig,
        patch,
        stub: orig.length > patch.length,
        semantic: point.semantic || '',
      });
    }
  }
  return entry;
}

function scan(root, points) {
  const byHost = new Map();
  for (const point of points) {
    if (!byHost.has(point.host)) byHost.set(point.host, []);
    byHost.get(point.host).push(point);
  }
  const hosts = [];
  for (const [host, list] of [...byHost.entries()].sort()) {
    hosts.push(scanHost(root, host, list));
  }
  const totals = { match: 0, already: 0, legacy: 0, mismatch: 0, gone: 0, total: 0 };
  for (const host of hosts) {
    for (const key of Object.keys(totals)) totals[key] += host.counts[key];
  }
  return { root, hosts, totals };
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sha256(buffer) {
  return require('node:crypto').createHash('sha256').update(buffer).digest('hex');
}

// Apply the points to disk. A file whose executable is running cannot be replaced,
// so the caller is expected to stop MuMu first (the panel does that for you).
function apply(root, points, options) {
  const opts = options || {};
  const dryRun = Boolean(opts.dryRun);
  const backupRoot = opts.backupDir
    || path.join(opts.backupBase || path.join(root, '..', 'mumu-static-backups'), stamp());
  const plan = scan(root, points);
  const report = {
    root,
    dryRun,
    backupDir: dryRun ? null : backupRoot,
    hosts: [],
    applied: 0,
    skipped: 0,
    wrote: false,
  };

  for (const host of plan.hosts) {
    const record = {
      host: host.host,
      path: host.path,
      exists: host.exists,
      applyable: host.applyable.length,
      applied: [],
      skippedByState: { ...host.counts, applyable: undefined, total: undefined },
      error: null,
    };
    if (!host.exists || host.applyable.length === 0) {
      report.hosts.push(record);
      continue;
    }
    try {
      const buffer = fs.readFileSync(host.path);
      const patched = Buffer.from(buffer);
      for (const point of host.applyable) {
        patched.set(point.patch, point.offset);
        if (point.stub) {
          patched.fill(NOP, point.offset + point.patch.length, point.offset + point.orig.length);
        }
        record.applied.push({
          id: point.id,
          offset: point.offset,
          orig: point.orig.toString('hex'),
          patch: point.patch.toString('hex'),
          stub: point.stub,
          semantic: point.semantic,
        });
      }
      report.applied += record.applied.length;
      if (dryRun) {
        report.hosts.push(record);
        continue;
      }
      fs.mkdirSync(backupRoot, { recursive: true });
      fs.copyFileSync(host.path, path.join(backupRoot, host.host));
      const tmp = `${host.path}.staticpatching`;
      fs.writeFileSync(tmp, patched);
      fs.renameSync(tmp, host.path);
      record.sha256 = sha256(fs.readFileSync(host.path));
      record.origSha256 = sha256(buffer);
      record.backup = path.join(backupRoot, host.host);
      report.wrote = true;
    } catch (error) {
      record.error = error && error.message ? error.message : String(error);
    }
    report.hosts.push(record);
  }

  if (!dryRun && report.wrote) {
    fs.writeFileSync(
      path.join(backupRoot, 'audit.json'),
      JSON.stringify({ stamp: path.basename(backupRoot), root, hosts: report.hosts }, null, 1),
      'utf8',
    );
  }
  report.after = dryRun ? null : scan(root, points).totals;
  return report;
}

function listBackups(root, base) {
  const dir = base || path.join(root, '..', 'mumu-static-backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, 'audit.json')))
    .sort()
    .reverse()
    .map((name) => ({ stamp: name, dir: path.join(dir, name) }));
}

function restore(root, backupDir) {
  const auditFile = path.join(backupDir, 'audit.json');
  if (!fs.existsSync(auditFile)) {
    return { restored: false, reason: 'no audit.json in the given backup folder', backupDir };
  }
  const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  const files = [];
  for (const host of audit.hosts || []) {
    const source = path.join(backupDir, host.host);
    if (!fs.existsSync(source)) {
      files.push({ host: host.host, restored: false, reason: 'backup file missing' });
      continue;
    }
    const target = hostPath(root, host.host);
    fs.copyFileSync(source, target);
    files.push({ host: host.host, restored: true, sha256: sha256(fs.readFileSync(target)) });
  }
  return { restored: true, backupDir, files };
}

module.exports = {
  POINT_STATE,
  readPoints,
  parseRva,
  peSections,
  rvaToOffset,
  scanHost,
  scan,
  apply,
  restore,
  listBackups,
  hostPath,
};
