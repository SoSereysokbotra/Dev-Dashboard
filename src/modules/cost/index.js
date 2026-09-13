const { shell } = require('electron');
const fs = require('fs');
const scanner = require('./scanner');
const panel = require('./panel');

module.exports = {
  id: 'cost',
  title: 'Cost / Project',
  order: 2,
  refreshMs: 60000,

  async summary() {
    const data = scanner.scanTranscripts();
    if (!data.available) {
      return {
        text: 'unavailable (no Claude Code data)',
        severity: 'unknown',
      };
    }

    if (!data.projects || data.projects.length === 0) {
      return {
        text: 'no activity $0',
        severity: 'ok',
      };
    }

    const top = data.projects[0];
    const roundedCost = Math.round(top.weekCost);

    return {
      text: `${top.displayName} $${roundedCost}`,
      severity: 'ok',
    };
  },

  async panel() {
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
