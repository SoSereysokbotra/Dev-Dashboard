'use strict';

const { shell } = require('electron');
const fs = require('fs');
const scanner = require('./scanner');
const remove = require('./remove');

module.exports = {
  id: 'disk',
  title: 'Disk',
  order: 3,
  refreshMs: 120000,

  setScanCompleteListener(fn) {
    scanner.setUpdateCallback(fn);
  },

  async summary() {
    return scanner.getCachedSummary();
  },

  async panel() {
    const candidates = scanner.getCachedCandidates();
    let totalCleanableBytes = 0;
    let safeCount = 0;

    candidates.forEach(c => {
      if (c.safety === 'safe' || c.safety === 'no-lockfile') {
        totalCleanableBytes += (c.sizeBytes || 0);
        if (c.safety === 'safe') safeCount++;
      }
    });

    return {
      available: true,
      title: 'Disk',
      candidates,
      totalCount: candidates.length,
      safeCount,
      totalCleanableBytes,
      totalCleanableFormatted: remove.formatBytes(totalCleanableBytes),
      statusText: `${remove.formatBytes(totalCleanableBytes)} cleanable across ${candidates.length} folders`,
    };
  },

  actions: {
    async clean(args) {
      const paths = (args && args.paths) || [];
      if (!Array.isArray(paths) || paths.length === 0) {
        return { success: false, error: 'No paths specified for cleaning' };
      }

      // Safety: check each path against scanner candidates to ensure lockfile requirement
      const candidates = scanner.getCachedCandidates();
      const candMap = new Map(candidates.map(c => [c.path.toLowerCase(), c]));

      for (const p of paths) {
        const item = candMap.get(p.toLowerCase());
        if (!item) {
          // Verify directory exists
          if (!fs.existsSync(p)) {
            return { success: false, error: `Path does not exist: ${p}` };
          }
        } else if (item.safety === 'in-use' && !args.forceOverride) {
          return {
            success: false,
            error: `Cannot delete active project folder in use: ${p}`,
          };
        }
      }

      const result = await remove.removeDirectories(paths);

      // Notify scanner of deleted items to update cache and summary
      if (result.results) {
        result.results.forEach(r => {
          if (r.success) {
            scanner.notifyDeleted(r.path);
          }
        });
      }

      return result;
    },

    async openFolder(args) {
      const targetPath = (args && args.path) || (typeof args === 'string' ? args : null);
      if (!targetPath) {
        return { success: false, error: 'No path specified' };
      }
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: 'Path does not exist: ' + targetPath };
      }
      const err = await shell.openPath(targetPath);
      if (err) {
        return { success: false, error: err };
      }
      return { success: true };
    },
  },
};
