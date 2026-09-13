'use strict';

module.exports = {
  id: 'cost',
  title: 'Cost / Project',
  order: 2,
  refreshMs: 60000,

  async summary() {
    return {
      text: 'unavailable',
      severity: 'unknown',
    };
  },

  async panel() {
    return {
      title: 'Cost / Project',
      items: [],
      statusText: 'Phase 3 module stub',
    };
  },

  actions: {},
};
