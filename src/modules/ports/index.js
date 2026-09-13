'use strict';

module.exports = {
  id: 'ports',
  title: 'Ports',
  order: 4,
  refreshMs: 60000,

  async summary() {
    return {
      text: 'unavailable',
      severity: 'unknown',
    };
  },

  async panel() {
    return {
      title: 'Active Ports',
      items: [],
      statusText: 'Phase 5 module stub',
    };
  },

  actions: {},
};
