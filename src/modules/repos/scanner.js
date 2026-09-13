'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IGNORE_DIRS = new Set([
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.cache',
  'AppData',
  'dist',
  'build',
  '.angular',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.venv',
  'venv',
  '.git',
]);

let isScanning = false;
let lastScanTime = 0;
let cachedResults = [];
let cachedSummary = { text: 'unavailable', severity: 'unknown' };
const repoMtimes = new Map(); // path -> mtimeMs

/**
 * Check if git is available on PATH.
 */
function checkGitInstalled() {
  return new Promise((resolve) => {
    execFile('git', ['--version'], { windowsHide: true, timeout: 3000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Fast filesystem walk to discover git repos up to maxDepth.
 * Does not descend into dependencies or subtrees of discovered repos.
 */
function discoverRepos(root, maxDepth = 4) {
  const repos = [];
  if (!fs.existsSync(root)) return repos;

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    let hasGit = false;
    for (const e of entries) {
      if (e.name === '.git') {
        hasGit = true;
        repos.push(dir);
        break;
      }
    }
    if (hasGit) return; // Do not descend into children of a git repository

    for (const e of entries) {
      if (e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('$')) {
        scan(path.join(dir, e.name), depth + 1);
      }
    }
  }

  scan(root, 0);
  return repos;
}

/**
 * Execute a read-only git command.
 */
function runGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout ? stdout.trim() : '');
    });
  });
}

/**
 * Get mtime for a repository's .git directory or file.
 */
function getGitMtime(repoPath) {
  try {
    const gitPath = path.join(repoPath, '.git');
    if (!fs.existsSync(gitPath)) return 0;
    const stat = fs.statSync(gitPath);
    let mtime = stat.mtimeMs;

    // If .git is a directory, also check index and HEAD if present
    if (stat.isDirectory()) {
      const indexPath = path.join(gitPath, 'index');
      if (fs.existsSync(indexPath)) {
        const indexStat = fs.statSync(indexPath);
        if (indexStat.mtimeMs > mtime) mtime = indexStat.mtimeMs;
      }
      const headPath = path.join(gitPath, 'HEAD');
      if (fs.existsSync(headPath)) {
        const headStat = fs.statSync(headPath);
        if (headStat.mtimeMs > mtime) mtime = headStat.mtimeMs;
      }
    }
    return mtime;
  } catch (err) {
    return 0;
  }
}

/**
 * Inspect a single repository.
 */
async function inspectRepo(repoPath, existingRecord) {
  const currentMtime = getGitMtime(repoPath);
  const lastMtime = repoMtimes.get(repoPath);

  // If mtime hasn't changed and we have a valid previous record, reuse it
  if (existingRecord && lastMtime && currentMtime === lastMtime) {
    return existingRecord;
  }

  // Read status with branch and upstream tracking, plus commit time in parallel
  const [statusOut, logOut] = await Promise.all([
    runGit(['-C', repoPath, 'status', '--porcelain', '-b']),
    runGit(['-C', repoPath, 'log', '-1', '--format=%ct']),
  ]);

  const record = {
    path: repoPath,
    name: path.basename(repoPath),
    branch: 'unknown',
    changed: 0,
    unpushed: null, // null means no upstream; 0 means synced
    behind: null,
    lastCommit: logOut ? parseInt(logOut, 10) : null,
    needsAttention: false,
    mtime: currentMtime,
  };

  if (statusOut != null) {
    const lines = statusOut.split('\n').map(l => l.trimEnd()).filter(Boolean);
    if (lines.length > 0) {
      const header = lines[0]; // e.g. "## main...origin/main [ahead 1, behind 2]"
      if (header.startsWith('## ')) {
        const branchPart = header.substring(3);
        const bracketIdx = branchPart.indexOf('[');
        let branchName = bracketIdx >= 0 ? branchPart.substring(0, bracketIdx).trim() : branchPart.trim();
        const hasUpstream = branchName.includes('...');

        if (hasUpstream) {
          const parts = branchName.split('...');
          record.branch = parts[0];
          record.unpushed = 0;
          record.behind = 0;

          if (bracketIdx >= 0) {
            const tracking = branchPart.substring(bracketIdx);
            const aheadMatch = tracking.match(/ahead (\d+)/);
            if (aheadMatch) record.unpushed = parseInt(aheadMatch[1], 10);
            const behindMatch = tracking.match(/behind (\d+)/);
            if (behindMatch) record.behind = parseInt(behindMatch[1], 10);
          }
        } else {
          // No upstream branch configured
          record.branch = branchName || '(detached)';
          record.unpushed = null;
          record.behind = null;
        }
      }
      record.changed = Math.max(0, lines.length - 1);
    }
  }

  // A repository needs attention if:
  // - it has unpushed commits (unpushed > 0)
  // - it has uncommitted/changed files (changed > 0)
  // - it is behind remote (behind > 0)
  if ((record.unpushed != null && record.unpushed > 0) || record.changed > 0 || (record.behind != null && record.behind > 0)) {
    record.needsAttention = true;
  }

  // Sample mtime after git commands complete so git's internal lockfiles/index touch
  // does not invalidate the cache on the next check.
  const finalMtime = getGitMtime(repoPath);
  record.mtime = finalMtime;
  repoMtimes.set(repoPath, finalMtime);
  return record;
}

/**
 * Worker pool to process items concurrently without overwhelming OS.
 */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Rank repositories:
 * 1. Unpushed first (descending count)
 * 2. Uncommitted/changed (descending count)
 * 3. Behind remote (descending count)
 * 4. Last commit recency
 */
function rankRepos(repos) {
  return repos.slice().sort((a, b) => {
    // Priority 1: Unpushed commits
    const aUnpushed = (a.unpushed != null && a.unpushed > 0) ? a.unpushed : 0;
    const bUnpushed = (b.unpushed != null && b.unpushed > 0) ? b.unpushed : 0;
    if (aUnpushed !== bUnpushed) return bUnpushed - aUnpushed;

    // Priority 2: Uncommitted changes
    if (a.changed !== b.changed) return b.changed - a.changed;

    // Priority 3: Behind remote
    const aBehind = (a.behind != null && a.behind > 0) ? a.behind : 0;
    const bBehind = (b.behind != null && b.behind > 0) ? b.behind : 0;
    if (aBehind !== bBehind) return bBehind - aBehind;

    // Priority 4: Attention needed before clean
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;

    // Priority 5: Last commit recency
    const aTime = a.lastCommit || 0;
    const bTime = b.lastCommit || 0;
    return bTime - aTime;
  });
}

let currentScanPromise = null;
let knownRepoPaths = [];
let lastDiscoveryTime = 0;

/**
 * Main scan function.
 */
async function runScan(rootPath = 'D:\\') {
  if (currentScanPromise) return currentScanPromise;

  currentScanPromise = (async () => {
    try {
      const gitOk = await module.exports.checkGitInstalled();
      if (!gitOk) {
        cachedSummary = { text: 'unavailable (git not found)', severity: 'unknown' };
        cachedResults = [];
        return { repos: [], summary: cachedSummary };
      }

      const now = Date.now();
      let repoPaths;
      // Cache the list of repo paths for 2 minutes to avoid walking the whole filesystem tree on every poll
      if (knownRepoPaths.length > 0 && (now - lastDiscoveryTime) < 120000) {
        repoPaths = knownRepoPaths;
      } else {
        repoPaths = discoverRepos(rootPath, 4);
        knownRepoPaths = repoPaths;
        lastDiscoveryTime = now;
      }

      // Map existing records by path for fast lookup
      const existingMap = new Map(cachedResults.map(r => [r.path, r]));

      // Inspect repos in parallel with concurrency of 12
      const rawResults = await mapPool(repoPaths, 12, async (p) => {
        return inspectRepo(p, existingMap.get(p));
      });

      cachedResults = rankRepos(rawResults);
      lastScanTime = Date.now();

      const attentionCount = cachedResults.filter(r => r.needsAttention).length;
      if (attentionCount > 0) {
        cachedSummary = {
          text: attentionCount + ' need attention',
          severity: 'warn',
        };
      } else {
        cachedSummary = {
          text: 'all clean',
          severity: 'ok',
        };
      }
    } catch (err) {
      console.error('[repos:scanner] scan failed:', err.message);
    } finally {
      currentScanPromise = null;
    }

    return { repos: cachedResults, summary: cachedSummary };
  })();

  return currentScanPromise;
}

function getCachedResults() {
  return cachedResults;
}

function getCachedSummary() {
  return cachedSummary;
}

module.exports = {
  checkGitInstalled,
  discoverRepos,
  inspectRepo,
  rankRepos,
  runScan,
  getCachedResults,
  getCachedSummary,
};
