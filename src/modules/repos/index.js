'use strict';

const { shell } = require('electron');
const fs = require('fs');
const scanner = require('./scanner');
const panel = require('./panel');

let onScanComplete = null;

module.exports = {
  id: 'repos',
  title: 'Repos',
  order: 1,
  refreshMs: 60000,

  setScanCompleteListener(fn) {
    onScanComplete = fn;
  },

  async summary() {
    const cached = scanner.getCachedSummary();

    // Trigger scan in background without blocking the summary call
    scanner.runScan().then(() => {
      if (onScanComplete) onScanComplete();
    }).catch((err) => {
      console.error('[repos] background scan error:', err.message);
    });

    return cached;
  },

  async panel() {
    const all = scanner.getCachedResults();
    if (all.length === 0) {
      await scanner.runScan();
    }
    return panel.buildPanelPayload();
  },

  actions: {
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
