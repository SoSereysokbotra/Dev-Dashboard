'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_TARGET_NAMES = new Set([
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

const ALLOWED_ROOTS = [
  'D:\\',
  'd:\\',
  process.env.TEMP || 'C:\\Windows\\Temp',
];

/**
 * Format bytes to human readable string (e.g. 382 MB, 1.4 GB).
 */
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return val.toFixed(i >= 2 ? 1 : 0) + ' ' + units[i];
}

/**
 * Convert a path to Windows extended-length prefix (\\?\) to bypass MAX_PATH (260).
 */
function toExtendedPath(p) {
  if (process.platform !== 'win32') return p;
  const abs = path.resolve(p);
  if (abs.startsWith('\\\\?\\')) return abs;
  if (abs.startsWith('\\\\')) {
    // UNC path: \\server\share -> \\?\UNC\server\share
    return '\\\\?\\UNC\\' + abs.substring(2);
  }
  return '\\\\?\\' + abs;
}

/**
 * Measure directory size before deletion (NTFS cluster allocation).
 */
function measureDirSize(dirPath) {
  let diskBytes = 0;
  const extPath = toExtendedPath(dirPath);

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.isSymbolicLink()) continue; // Never follow symlinks/junctions

      const fullPath = path.join(current, e.name);
      if (e.isDirectory()) {
        walk(fullPath);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(fullPath);
          diskBytes += st.size === 0 ? 0 : Math.ceil(st.size / 4096) * 4096;
        } catch (e) {}
      }
    }
  }

  try {
    walk(extPath);
  } catch (err) {}
  return diskBytes;
}

/**
 * Validate that a target path is strictly safe to delete:
 * 1. Must not contain .git
 * 2. Must be within allowed roots
 * 3. Base directory name must be a recognized rebuildable folder
 * 4. Must not be a junction or symlink
 */
function validateDeletionTarget(targetPath, allowScratch = false) {
  if (!targetPath || typeof targetPath !== 'string') {
    return { safe: false, reason: 'Invalid path' };
  }

  const normalized = targetPath.replace(/\\+/g, '/').toLowerCase();

  // Guardrail 1: Never delete a path containing .git
  if (normalized.includes('/.git') || normalized.endsWith('/.git') || normalized.includes('.git/')) {
    return { safe: false, reason: 'Path contains .git — forbidden' };
  }

  // Guardrail 2: Must be within allowed scan roots
  const isAllowedRoot = ALLOWED_ROOTS.some(r => {
    const normRoot = r.replace(/\\+/g, '/').toLowerCase();
    return normalized.startsWith(normRoot);
  }) || (allowScratch && normalized.includes('scratch'));

  if (!isAllowedRoot) {
    return { safe: false, reason: 'Path is outside configured scan roots' };
  }

  // Guardrail 3: Must be a recognized rebuildable target name
  const baseName = path.basename(targetPath).toLowerCase();
  if (!ALLOWED_TARGET_NAMES.has(baseName) && !allowScratch) {
    return { safe: false, reason: `Directory '${baseName}' is not a recognized rebuildable target` };
  }

  // Guardrail 4: Never follow junctions or symbolic links
  try {
    const lstat = fs.lstatSync(targetPath);
    if (lstat.isSymbolicLink()) {
      return { safe: false, reason: 'Target is a junction/symlink — deletion skipped' };
    }
  } catch (err) {
    return { safe: false, reason: 'Path does not exist or cannot be stated' };
  }

  return { safe: true };
}

/**
 * Safely remove a directory with long path handling, verification, and re-measurement.
 */
async function removeDirectory(targetPath, options = {}) {
  const allowScratch = Boolean(options.allowScratch);
  const validation = validateDeletionTarget(targetPath, allowScratch);
  if (!validation.safe) {
    return {
      success: false,
      path: targetPath,
      error: validation.reason,
      freedBytes: 0,
    };
  }

  // Measure size before removal
  const initialSize = measureDirSize(targetPath);

  const extPath = toExtendedPath(targetPath);

  try {
    fs.rmSync(extPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  } catch (err) {
    return {
      success: false,
      path: targetPath,
      error: err.message,
      freedBytes: 0,
    };
  }

  // Verify the directory is actually gone
  const stillExists = fs.existsSync(extPath) || fs.existsSync(targetPath);
  if (stillExists) {
    // Partial deletion failure
    const remainingSize = measureDirSize(targetPath);
    const partiallyFreed = Math.max(0, initialSize - remainingSize);
    return {
      success: false,
      path: targetPath,
      error: 'Directory could not be completely removed (in-use or permission denied)',
      freedBytes: partiallyFreed,
      freedFormatted: formatBytes(partiallyFreed),
    };
  }

  // Re-measured freed space
  return {
    success: true,
    path: targetPath,
    freedBytes: initialSize,
    freedFormatted: formatBytes(initialSize),
  };
}

/**
 * Remove multiple directories and return aggregated re-measured freed space.
 */
async function removeDirectories(targetPaths, options = {}) {
  const results = [];
  let totalFreedBytes = 0;

  for (const p of targetPaths) {
    const res = await removeDirectory(p, options);
    results.push(res);
    if (res.freedBytes > 0) {
      totalFreedBytes += res.freedBytes;
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;

  return {
    success: failureCount === 0,
    results,
    totalFreedBytes,
    totalFreedFormatted: formatBytes(totalFreedBytes),
    successCount,
    failureCount,
  };
}

module.exports = {
  ALLOWED_TARGET_NAMES,
  ALLOWED_ROOTS,
  toExtendedPath,
  formatBytes,
  measureDirSize,
  validateDeletionTarget,
  removeDirectory,
  removeDirectories,
};
