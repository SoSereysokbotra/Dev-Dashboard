'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

// Published rates, USD per million tokens (PHASES.md §B).
const PRICING = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

// Cache multipliers on the input rate.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;

function priceFor(model) {
  if (PRICING[model]) return PRICING[model];
  // A model released after this table was written falls back to its tier
  // rather than silently costing nothing.
  if (/opus/.test(model || '')) return PRICING['claude-opus-5'];
  if (/fable|mythos/.test(model || '')) return PRICING['claude-fable-5-1'];
  if (/sonnet/.test(model || '')) return PRICING['claude-sonnet-5'];
  if (/haiku/.test(model || '')) return PRICING['claude-haiku-4-5'];
  return null;
}

function calculateEntryCost(e) {
  const p = priceFor(e.model);
  if (!p) return 0;
  return (
    e.input * p.in +
    e.output * p.out +
    e.cacheRead * p.in * CACHE_READ_MULT +
    e.cacheWrite5m * p.in * CACHE_WRITE_5M_MULT +
    e.cacheWrite1h * p.in * CACHE_WRITE_1H_MULT
  ) / 1e6;
}

// ---------------------------------------------------------------------------
// Source: session transcripts (~/.claude/projects/<slug>/<session-id>.jsonl).
// Always current, never stale. Scanned incrementally using byte offsets
// so each refresh stays cheap (< 10 ms).
// ---------------------------------------------------------------------------

// absolute path -> { size, startOffset, entries }
const fileCache = new Map();
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function listLogFiles() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (err) {
      continue;
    }
    for (const f of files) {
      if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
    }
  }
  return out;
}

function parseChunk(text, entries, cutoffMs) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.indexOf('"usage"') === -1) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      continue;
    }
    if (rec.type !== 'assistant') continue;

    const msg = rec.message;
    if (!msg || !msg.usage) continue;
    // Locally synthesized messages never hit the API and are never billed.
    if (msg.model === '<synthetic>') continue;

    const ts = Date.parse(rec.timestamp || '');
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;

    const u = msg.usage;
    const cc = u.cache_creation || {};
    entries.push({
      // Resumed and forked sessions replay history into new files, so the same
      // assistant message appears many times. Dedupe on the API's own ids.
      key: (msg.id || '') + '|' + (rec.requestId || ''),
      ts: ts,
      model: msg.model || 'unknown',
      cwd: rec.cwd || 'unknown',
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite5m: cc.ephemeral_5m_input_tokens || 0,
      cacheWrite1h: cc.ephemeral_1h_input_tokens || 0,
    });
  }
}

function refreshFileCache() {
  const cutoffMs = Date.now() - RETAIN_MS;
  const seenPaths = new Set();
  const files = listLogFiles();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    seenPaths.add(file);

    let stat;
    try {
      stat = fs.statSync(file);
    } catch (err) {
      continue;
    }

    const cached = fileCache.get(file);
    if (cached && cached.size === stat.size) continue; // untouched since last scan

    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch (err) {
      continue;
    }

    try {
      // The normal case is an append, so read only new bytes. A file that
      // shrank was rewritten, so start over from 0.
      const appendOnly = !!cached && stat.size > cached.size;
      const start = appendOnly ? cached.startOffset : 0;
      const entries = appendOnly ? cached.entries : [];
      const length = stat.size - start;

      if (length > 0) {
        const buf = Buffer.allocUnsafe(length);
        fs.readSync(fd, buf, 0, length, start);
        const text = buf.toString('utf8');

        // A trailing partial line gets completed by a later append, so re-read
        // it next time instead of dropping it.
        const lastNewline = text.lastIndexOf('\n');
        const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline);
        parseChunk(complete, entries, cutoffMs);

        const consumed = lastNewline === -1 ? 0 : Buffer.byteLength(complete, 'utf8') + 1;
        fileCache.set(file, {
          size: stat.size,
          startOffset: start + consumed,
          entries: entries,
        });
      } else {
        fileCache.set(file, { size: stat.size, startOffset: start, entries: entries });
      }
    } catch (err) {
      // Leave file out of snapshot rather than failing whole scan
    } finally {
      try { fs.closeSync(fd); } catch (err) {}
    }
  }

  for (const key of Array.from(fileCache.keys())) {
    if (!seenPaths.has(key)) fileCache.delete(key);
  }
}

/**
 * Windows path normalisation (Trap T9):
 * Lower-case, forward slashes, no trailing slash.
 */
function normalizePath(p) {
  if (!p || typeof p !== 'string') return 'unknown';
  const norm = p.replace(/\\+/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm || 'unknown';
}

/**
 * Scan transcripts and aggregate by project for today and last 7 days.
 */
function scanTranscripts() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return {
      available: false,
      reason: 'no-projects-dir',
      projects: [],
      grandTotalWeekCost: 0,
      grandTotalTodayCost: 0,
    };
  }

  refreshFileCache();

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - SEVEN_DAYS;

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const todayStartMs = midnight.getTime();

  let totalRecords = 0;
  let duplicatesSkipped = 0;
  const seenKeys = new Set();

  const projectMap = new Map(); // normPath -> projectData
  let grandTotalWeekCost = 0;
  let grandTotalTodayCost = 0;

  for (const rec of fileCache.values()) {
    const entries = rec.entries;
    for (let i = 0; i < entries.length; i++) {
      totalRecords++;
      const e = entries[i];
      if (seenKeys.has(e.key)) {
        duplicatesSkipped++;
        continue;
      }
      seenKeys.add(e.key);

      const isWeek = e.ts >= sevenDaysAgo;
      const isToday = e.ts >= todayStartMs;
      if (!isWeek && !isToday) continue;

      const cost = calculateEntryCost(e);

      if (isWeek) grandTotalWeekCost += cost;
      if (isToday) grandTotalTodayCost += cost;

      const normCwd = normalizePath(e.cwd);
      let pData = projectMap.get(normCwd);
      if (!pData) {
        // Extract display name from folder basename
        const clean = e.cwd.replace(/\\+/g, '/').replace(/\/+$/, '');
        const parts = clean.split('/');
        const dispName = parts[parts.length - 1] || clean;

        pData = {
          rawPath: e.cwd,
          normPath: normCwd,
          displayName: dispName,
          weekCost: 0,
          todayCost: 0,
          messages: 0,
        };
        projectMap.set(normCwd, pData);
      }

      if (isWeek) pData.weekCost += cost;
      if (isToday) pData.todayCost += cost;
      pData.messages++;
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) => b.weekCost - a.weekCost);

  return {
    available: true,
    fileCount: fileCache.size,
    totalRecords: totalRecords,
    uniqueMessages: seenKeys.size,
    duplicatesSkipped: duplicatesSkipped,
    projectCount: projectMap.size,
    grandTotalWeekCost: grandTotalWeekCost,
    grandTotalTodayCost: grandTotalTodayCost,
    projects: projects,
  };
}

module.exports = {
  PROJECTS_DIR,
  PRICING,
  priceFor,
  calculateEntryCost,
  normalizePath,
  scanTranscripts,
  refreshFileCache,
};
