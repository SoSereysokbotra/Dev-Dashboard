'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { formatBytes, measureDirSize } = require('./remove');

const SCAN_ROOT = 'D:\\';

const TARGET_NAMES = new Set([
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'dist',
  'build',
  '.next',
  '.nuxt',
]);

const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  '.cache',
  'appdata',
  '.git',
]);

const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'poetry.lock',
  'Pipfile.lock',
  'requirements.txt',
  'Cargo.lock',
  'composer.lock',
];

const CACHE_FILE = path.join(os.homedir(), '.claude', 'disk_sizes_cache.json');

// Memory caches
let sizeCache = new Map(); // path -> { size, mtimeMs, lastScanned }
let cachedCandidates = [];
let cachedSummary = { text: 'scanning...', severity: 'unknown' };
let isSizingRunning = false;
let lastScanTimestamp = 0;
let onUpdateCallback = null;

function setUpdateCallback(fn) {
  onUpdateCallback = fn;
}

// Load persistent size cache on startup
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        sizeCache.set(k, v);
      }
    }
  }
} catch (e) {
  // Ignore corrupted cache file
}

function saveSizeCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [k, v] of sizeCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Extract paths associated with currently running processes.
 */
function getActiveProcessPaths() {
  const activePaths = new Set();
  // Always include the current running app's directory
  activePaths.add(path.resolve(__dirname, '..', '..', '..').toLowerCase());

  try {
    const stdout = execSync(
      'powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"',
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const matches = stdout.matchAll(/[a-zA-Z]:\\[^"'\s;,]+/g);
    for (const m of matches) {
      activePaths.add(m[0].replace(/\\+$/, '').toLowerCase());
    }
  } catch (e) {}

  return activePaths;
}

/**
 * Check if a project contains a lockfile.
 */
function checkLockfile(dir) {
  for (const lf of LOCKFILES) {
    if (fs.existsSync(path.join(dir, lf))) {
      return lf;
    }
  }
  return null;
}

/**
 * Find the latest mtime among project source files (excluding dependencies and .git).
 */
function getProjectLastModified(projectDir) {
  let latestMtime = 0;
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.name.startsWith('.') && e.name !== '.git') continue;
      if (TARGET_NAMES.has(e.name.toLowerCase())) continue;
      try {
        const st = fs.statSync(path.join(projectDir, e.name));
        if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
      } catch (err) {}
    }
  } catch (err) {}
  return latestMtime;
}

/**
 * Fast filesystem walk to discover rebuildable folders up to maxDepth.
 */
function discoverCandidates(rootDir = SCAN_ROOT, maxDepth = 5) {
  const candidates = [];
  if (!fs.existsSync(rootDir)) return candidates;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const lower = e.name.toLowerCase();
      if (lower.startsWith('$') || SKIP_DIRS.has(lower)) continue;

      if (e.isDirectory() || e.isSymbolicLink()) {
        // Skip junctions and symlinks (Requirement 3)
        if (e.isSymbolicLink()) continue;

        const fullPath = path.join(dir, e.name);
        if (TARGET_NAMES.has(lower)) {
          candidates.push({
            type: e.name,
            path: fullPath,
            parent: dir,
          });
          // Do not descend into dependency/build directories
        } else {
          walk(fullPath, depth + 1);
        }
      }
    }
  }

  walk(rootDir, 0);
  return candidates;
}

/**
 * Full scan and assessment of candidates.
 */
function assessCandidates() {
  const rawList = discoverCandidates(SCAN_ROOT, 5);
  const activeProcessPaths = getActiveProcessPaths();
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const results = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    const normPath = item.path.toLowerCase();
    const normParent = item.parent.toLowerCase();

    const lockfile = checkLockfile(item.parent);
    const lastMod = getProjectLastModified(item.parent);
    const daysIdle = lastMod > 0 ? Math.round((now - lastMod) / (1000 * 60 * 60 * 24)) : 999;

    // Check if project or candidate folder is active
    let inUse = false;
    let inUseReason = null;

    for (const act of activeProcessPaths) {
      if (normPath.startsWith(act) || act.startsWith(normPath) || normParent.startsWith(act) || act.startsWith(normParent)) {
        inUse = true;
        inUseReason = 'running process';
        break;
      }
    }

    if (!inUse && daysIdle < 7) {
      inUse = true;
      inUseReason = 'recently modified (< 7d)';
    }

    // Safety classification
    let safety = 'safe';
    let safetyLabel = 'Safe to clean';
    if (inUse) {
      safety = 'in-use';
      safetyLabel = inUseReason || 'In use';
    } else if (!lockfile) {
      safety = 'no-lockfile';
      safetyLabel = 'No lockfile';
    }

    // Check size cache
    let sizeBytes = 0;
    let sizeCalculated = false;
    let dirMtime = 0;

    try {
      const st = fs.statSync(item.path);
      dirMtime = Math.round(st.mtimeMs);
    } catch (e) {}

    const cached = sizeCache.get(item.path);
    if (cached && cached.mtimeMs === dirMtime) {
      sizeBytes = cached.size;
      sizeCalculated = true;
    }

    // Human-friendly project title
    const cleanParent = item.parent.replace(/\\+/g, '/').replace(/\/+$/, '');
    const parentParts = cleanParent.split('/');
    const projectName = parentParts[parentParts.length - 1] || cleanParent;

    results.push({
      id: Buffer.from(item.path).toString('base64').replace(/=/g, ''),
      type: item.type,
      path: item.path,
      parent: item.parent,
      projectName,
      lockfile,
      daysIdle,
      inUse,
      inUseReason,
      safety,
      safetyLabel,
      sizeBytes,
      sizeCalculated,
      sizeFormatted: sizeCalculated ? formatBytes(sizeBytes) : 'sizing...',
      dirMtime,
    });
  }

  // Sort by safety (safe first, then no-lockfile, then in-use), then by size desc
  const safetyOrder = { 'safe': 1, 'no-lockfile': 2, 'in-use': 3 };
  results.sort((a, b) => {
    const diff = (safetyOrder[a.safety] || 9) - (safetyOrder[b.safety] || 9);
    if (diff !== 0) return diff;
    return b.sizeBytes - a.sizeBytes;
  });

  cachedCandidates = results;
  lastScanTimestamp = now;

  // Start background sizing for uncalculated candidates
  startBackgroundSizing();

  updateCachedSummary();

  return results;
}

/**
 * Background worker to size candidates incrementally without blocking UI.
 */
function startBackgroundSizing() {
  if (isSizingRunning) return;
  isSizingRunning = true;

  setImmediate(async () => {
    try {
      const uncalculated = cachedCandidates.filter(c => !c.sizeCalculated);
      for (let i = 0; i < uncalculated.length; i++) {
        const item = uncalculated[i];
        if (!fs.existsSync(item.path)) continue;

        const size = measureDirSize(item.path);
        item.sizeBytes = size;
        item.sizeCalculated = true;
        item.sizeFormatted = formatBytes(size);

        sizeCache.set(item.path, {
          size,
          mtimeMs: item.dirMtime,
          timestamp: Date.now(),
        });

        // Save cache periodically
        if (i % 10 === 0 || i === uncalculated.length - 1) {
          saveSizeCache();
          updateCachedSummary();
        }

        // Brief yield every few folders to maintain responsiveness
        await new Promise(r => setTimeout(r, 10));
      }
    } catch (e) {
      console.error('[disk scanner] sizing error:', e.message);
    } finally {
      isSizingRunning = false;
      saveSizeCache();
      updateCachedSummary();
    }
  });
}

/**
 * Update cached summary for the home view.
 */
function updateCachedSummary() {
  let totalCleanableBytes = 0;
  let count = 0;

  for (const c of cachedCandidates) {
    if (c.safety === 'safe' || c.safety === 'no-lockfile') {
      totalCleanableBytes += c.sizeBytes;
      count++;
    }
  }

  if (totalCleanableBytes > 0) {
    cachedSummary = {
      text: `${formatBytes(totalCleanableBytes)} to clean`,
      severity: 'ok',
    };
  } else if (cachedCandidates.length > 0) {
    cachedSummary = {
      text: `${cachedCandidates.length} folders found`,
      severity: 'ok',
    };
  } else {
    cachedSummary = {
      text: 'clean',
      severity: 'ok',
    };
  }

  if (onUpdateCallback) {
    try {
      onUpdateCallback();
    } catch (e) {}
  }
}

function getCachedSummary() {
  if (cachedCandidates.length === 0 && Date.now() - lastScanTimestamp > 60000) {
    assessCandidates();
  }
  return cachedSummary;
}

function getCachedCandidates() {
  if (cachedCandidates.length === 0 || Date.now() - lastScanTimestamp > 60000) {
    return assessCandidates();
  }
  return cachedCandidates;
}

/**
 * Remove an item from memory and cache after successful deletion.
 */
function notifyDeleted(deletedPath) {
  sizeCache.delete(deletedPath);
  cachedCandidates = cachedCandidates.filter(c => c.path !== deletedPath);
  saveSizeCache();
  updateCachedSummary();
}

module.exports = {
  SCAN_ROOT,
  TARGET_NAMES,
  LOCKFILES,
  formatBytes,
  getActiveProcessPaths,
  checkLockfile,
  getProjectLastModified,
  discoverCandidates,
  assessCandidates,
  getCachedSummary,
  getCachedCandidates,
  notifyDeleted,
  sizeCache,
  setUpdateCallback,
};
