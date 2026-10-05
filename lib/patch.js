'use strict';

// Patch engine for the MuMu winhttp proxy.
//
// Two tables drive everything:
//   proxy-file-patches.json  the in-file corrections written into nx_main\winhttp.dll
//   points.json              the runtime point table the proxy applies in memory,
//                            verified here against the target executables
//
// The invariant inherited from the project's ADRs: a point is only ever written
// when its original bytes are present AND unique in the file. Anything else is
// reported and left untouched.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_MARKER = 'mumu_guard_winhttp.log';
const BACKUP_TAG = '.mumu-backup-';

const STATE = {
  ABSENT: 'absent',
  NOT_PROXY: 'not-a-proxy',
  LEGACY: 'proxy-6.8.1-flavour',
  CORRECTED: 'proxy-6.8.2-corrected',
  UNKNOWN: 'proxy-unknown',
};

const FILE_POINT_STATE = {
  APPLIED: 'applied',
  ALREADY: 'already',
  MISMATCH: 'mismatch',
  SKIPPED: 'skipped',
  GONE: 'gone',
};

const RUNTIME_POINT_STATE = {
  MATCH: 'match',
  ALREADY: 'already',
  LEGACY: 'legacy',
  MISMATCH: 'mismatch',
  GONE: 'gone',
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function hex(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('hex');
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle, 0);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

function readTables(pluginRoot) {
  const dir = path.join(pluginRoot, 'patch');
  const pointsDoc = JSON.parse(fs.readFileSync(path.join(dir, 'points.json'), 'utf8'));
  const filesDoc = JSON.parse(fs.readFileSync(path.join(dir, 'proxy-file-patches.json'), 'utf8'));
  // Normalised shape: callers get the arrays directly plus the table metadata.
  return {
    patches: filesDoc.patches || [],
    points: pointsDoc.points || [],
    schema: filesDoc.schema || null,
    pointsSchema: pointsDoc.schema || null,
    sourceSha256: filesDoc.sourceSha256 || null,
    resultSha256: filesDoc.resultSha256 || null,
    targetFile: filesDoc.targetFile || null,
    filePatchCount: (filesDoc.patches || []).length,
    pointCount: (pointsDoc.points || []).length,
  };
}

// ---------------------------------------------------------------------------
// PE helpers: turn an RVA into a file offset using the section table.
// ---------------------------------------------------------------------------

function readPeSections(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) return null;
  const coff = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(coff + 2);
  const optionalSize = buffer.readUInt16LE(coff + 16);
  const sectionTable = coff + 20 + optionalSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const entry = sectionTable + i * 40;
    if (entry + 40 > buffer.length) break;
    sections.push({
      name: buffer.subarray(entry, entry + 8).toString('ascii').replace(/\0+$/, ''),
      virtualSize: buffer.readUInt32LE(entry + 8),
      virtualAddress: buffer.readUInt32LE(entry + 12),
      rawSize: buffer.readUInt32LE(entry + 16),
      rawPointer: buffer.readUInt32LE(entry + 20),
    });
  }
  return sections;
}

function rvaToOffset(sections, rva) {
  if (!sections) return null;
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      const delta = rva - section.virtualAddress;
      if (delta >= section.rawSize) return null; // lives in virtual space only
      return section.rawPointer + delta;
    }
  }
  return null;
}

// RVAs arrive either as plain decimal or as 0x-prefixed hex depending on which
// generator produced the table. Accept both rather than guessing one.
function parseRva(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  if (/^0x/i.test(text)) {
    const parsedHex = Number.parseInt(text.slice(2), 16);
    return Number.isFinite(parsedHex) ? parsedHex : null;
  }
  const parsedDec = Number.parseInt(text, 10);
  return Number.isFinite(parsedDec) ? parsedDec : null;
}

// ---------------------------------------------------------------------------
// File patch table: inspect / apply / restore
// ---------------------------------------------------------------------------

function targetDllPath(root) {
  return path.join(root, 'nx_main', 'winhttp.dll');
}

function inspectFilePoints(buffer, table) {
  const results = [];
  for (const entry of table.patches) {
    const offset = Number.parseInt(String(entry.targetFileOffset).replace(/^0x/i, ''), 16);
    const orig = Buffer.from(entry.orig, 'hex');
    const patch = Buffer.from(entry.patch, 'hex');
    const record = {
      id: entry.id,
      rva: entry.rva || null,
      fileOffset: entry.targetFileOffset,
      orig: entry.orig,
      patch: entry.patch,
      state: null,
      reason: null,
    };
    if (!Number.isFinite(offset) || offset < 0 || offset + orig.length > buffer.length) {
      record.state = FILE_POINT_STATE.GONE;
      record.reason = 'offset outside the file';
      results.push(record);
      continue;
    }
    const current = hex(buffer, offset, orig.length);
    if (current === entry.patch) {
      record.state = FILE_POINT_STATE.ALREADY;
      results.push(record);
      continue;
    }
    if (current !== entry.orig) {
      record.state = FILE_POINT_STATE.MISMATCH;
      record.reason = 'neither the original nor the patched bytes are present';
      record.found = current;
      results.push(record);
      continue;
    }
    const occurrences = countOccurrences(buffer, orig);
    if (occurrences !== 1) {
      record.state = FILE_POINT_STATE.SKIPPED;
      record.reason = `original bytes appear ${occurrences} times, expected exactly 1`;
      results.push(record);
      continue;
    }
    record.state = FILE_POINT_STATE.APPLIED;
    results.push(record);
  }
  return results;
}

function summarizeFilePoints(results) {
  const counts = {
    applied: 0,
    already: 0,
    mismatch: 0,
    skipped: 0,
    gone: 0,
    total: results.length,
  };
  for (const record of results) counts[record.state] = (counts[record.state] || 0) + 1;
  return counts;
}

function classifyProxy(buffer) {
  if (!buffer) return STATE.ABSENT;
  if (buffer.indexOf(PROXY_MARKER) === -1) return STATE.NOT_PROXY;
  return STATE.UNKNOWN;
}

function inspectFile(filePath, table) {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      state: STATE.ABSENT,
      sha256: null,
      size: 0,
      points: [],
      counts: summarizeFilePoints([]),
      markerPresent: false,
    };
  }
  const buffer = fs.readFileSync(filePath);
  const points = inspectFilePoints(buffer, table);
  const counts = summarizeFilePoints(points);
  let state = classifyProxy(buffer);
  if (state === STATE.UNKNOWN) {
    if (counts.already > 0 && counts.mismatch === 0 && counts.gone === 0 && counts.skipped === 0) state = STATE.CORRECTED;
    else if (counts.applied > 0) state = STATE.LEGACY;
    else state = STATE.UNKNOWN;
  }
  return {
    path: filePath,
    exists: true,
    state,
    sha256: sha256(buffer),
    size: buffer.length,
    markerPresent: buffer.indexOf(PROXY_MARKER) !== -1,
    points,
    counts,
  };
}

function listBackups(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(base + BACKUP_TAG) && name.toLowerCase().endsWith('.dll'))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { path: full, name, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function applyFile(filePath, table, options) {
  const settings = options || {};
  const dryRun = Boolean(settings.dryRun);
  const keepBackups = settings.keepBackups !== false;
  const report = {
    path: filePath,
    dryRun,
    wrote: false,
    backup: null,
    audit: null,
    sha256Before: null,
    sha256After: null,
    state: null,
    counts: null,
    points: [],
    refused: null,
  };
  if (!fs.existsSync(filePath)) {
    report.refused = 'the target file does not exist';
    return report;
  }
  const buffer = fs.readFileSync(filePath);
  report.sha256Before = sha256(buffer);

  if (classifyProxy(buffer) !== STATE.UNKNOWN) {
    report.refused = 'the target file is not the winhttp proxy this table targets';
    report.points = [];
    report.counts = summarizeFilePoints([]);
    return report;
  }

  const points = inspectFilePoints(buffer, table);
  const counts = summarizeFilePoints(points);
  report.points = points;
  report.counts = counts;
  report.state = counts.applied > 0 ? STATE.LEGACY : STATE.CORRECTED;

  const pending = points.filter((record) => record.state === FILE_POINT_STATE.APPLIED);
  if (!pending.length) {
    report.refused = counts.already === counts.total ? null : 'no point matched its original bytes, nothing was written';
    report.sha256After = report.sha256Before;
    return report;
  }
  if (dryRun) {
    report.sha256After = report.sha256Before;
    return report;
  }

  const patched = Buffer.from(buffer);
  for (const record of pending) {
    const offset = Number.parseInt(String(record.fileOffset).replace(/^0x/i, ''), 16);
    Buffer.from(record.patch, 'hex').copy(patched, offset);
  }

  if (keepBackups) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tag = stamp(new Date());
    const backupPath = path.join(dir, `${base}${BACKUP_TAG}${tag}.dll`);
    fs.writeFileSync(backupPath, buffer);
    const auditPath = path.join(dir, `${base}${BACKUP_TAG}${tag}.json`);
    const audit = {
      createdAt: new Date().toISOString(),
      target: filePath,
      backup: backupPath,
      sha256Before: report.sha256Before,
      sha256After: sha256(patched),
      size: patched.length,
      stateBefore: report.state,
      applied: pending.map((record) => record.id),
      skipped: points.filter((record) => record.state !== FILE_POINT_STATE.APPLIED).map((record) => ({ id: record.id, state: record.state })),
      tableSchema: table.schema,
      tableSourceSha256: table.sourceSha256 || null,
      tableResultSha256: table.resultSha256 || null,
    };
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
    report.backup = backupPath;
    report.audit = auditPath;
  }

  fs.writeFileSync(filePath, patched);
  report.wrote = true;
  report.sha256After = sha256(patched);
  return report;
}

function restoreFile(filePath, backupPath, options) {
  const settings = options || {};
  const report = {
    path: filePath,
    restoredFrom: null,
    wrote: false,
    sha256Before: null,
    sha256After: null,
    refused: null,
  };
  if (!fs.existsSync(filePath)) {
    report.refused = 'the target file does not exist';
    return report;
  }
  let source = backupPath;
  if (!source) {
    const backups = listBackups(filePath);
    if (!backups.length) {
      report.refused = 'no backup written by this plugin was found beside the target';
      return report;
    }
    source = backups[0].path;
  }
  if (!fs.existsSync(source)) {
    report.refused = `the backup file does not exist: ${source}`;
    return report;
  }
  const current = fs.readFileSync(filePath);
  const backup = fs.readFileSync(source);
  report.sha256Before = sha256(current);
  report.restoredFrom = source;
  if (settings.dryRun) {
    report.sha256After = report.sha256Before;
    return report;
  }
  fs.writeFileSync(filePath, backup);
  report.wrote = true;
  report.sha256After = sha256(backup);
  return report;
}

// ---------------------------------------------------------------------------
// Runtime point table: offline verification against the target executables
// ---------------------------------------------------------------------------

function verifyRuntime(root, table) {
  const byHost = new Map();
  for (const point of table.points) {
    if (!byHost.has(point.host)) byHost.set(point.host, []);
    byHost.get(point.host).push(point);
  }

  const hosts = [];
  for (const [host, points] of byHost) {
    const filePath = path.join(root, 'nx_main', host);
    const entry = {
      host,
      path: filePath,
      exists: fs.existsSync(filePath),
      size: 0,
      counts: { match: 0, already: 0, legacy: 0, mismatch: 0, gone: 0, total: points.length },
      mismatches: [],
    };
    if (!entry.exists) {
      entry.counts.gone = points.length;
      hosts.push(entry);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    entry.size = buffer.length;
    const sections = readPeSections(buffer);
    if (!sections) {
      entry.counts.gone = points.length;
      entry.note = 'not a PE image';
      hosts.push(entry);
      continue;
    }
    for (const point of points) {
      const rva = parseRva(point.rva);
      const offset = rva === null ? null : rvaToOffset(sections, rva);
      const orig = Buffer.from(point.orig, 'hex');
      const patch = Buffer.from(point.patch, 'hex');
      let state;
      if (offset === null || offset + orig.length > buffer.length) {
        state = RUNTIME_POINT_STATE.GONE;
      } else {
        const current = hex(buffer, offset, orig.length);
        if (current === point.orig) state = RUNTIME_POINT_STATE.MATCH;
        else if (current === point.patch) state = RUNTIME_POINT_STATE.ALREADY;
        else if (point.origLegacy && current === point.origLegacy) state = RUNTIME_POINT_STATE.LEGACY;
        else state = RUNTIME_POINT_STATE.MISMATCH;
      }
      entry.counts[state] += 1;
      if (state === RUNTIME_POINT_STATE.MISMATCH) {
        entry.mismatches.push({ id: point.id, rva: point.rva, expected: point.orig });
      }
    }
    hosts.push(entry);
  }
  return hosts;
}

function status(root, table) {
  const filePath = targetDllPath(root);
  const file = inspectFile(filePath, table);
  const runtime = verifyRuntime(root, table);
  return {
    root,
    file,
    runtime,
    backups: listBackups(filePath),
    table: {
      schema: table.schema || null,
      pointsSchema: table.pointsSchema || null,
      filePatchCount: table.filePatchCount,
      pointCount: table.pointCount,
      sourceSha256: table.sourceSha256 || null,
      resultSha256: table.resultSha256 || null,
    },
  };
}

module.exports = {
  PROXY_MARKER,
  BACKUP_TAG,
  STATE,
  FILE_POINT_STATE,
  RUNTIME_POINT_STATE,
  sha256,
  readTables,
  readPeSections,
  rvaToOffset,
  targetDllPath,
  inspectFile,
  inspectFilePoints,
  summarizeFilePoints,
  classifyProxy,
  listBackups,
  applyFile,
  restoreFile,
  verifyRuntime,
  status,
};
