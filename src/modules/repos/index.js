'use strict';

module.exports = {
  id: 'repos',
  title: 'Repos',
  order: 1,
  refreshMs: 60000,

  async summary() {
    return {
      text: 'unavailable',
      severity: 'unknown',
    };
  },

  async panel() {
    return {
      title: 'Repositories',
      items: [],
      statusText: 'Phase 2 module stub',
    };
  },

  actions: {},
};
