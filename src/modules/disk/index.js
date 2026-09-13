'use strict';

module.exports = {
  id: 'disk',
  title: 'Disk',
  order: 3,
  refreshMs: 60000,

  async summary() {
    return {
      text: 'unavailable',
      severity: 'unknown',
    };
  },

  async panel() {
    return {
      title: 'Disk Cleanup',
      items: [],
      statusText: 'Phase 4 module stub',
    };
  },

  actions: {},
};
