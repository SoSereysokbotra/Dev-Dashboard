'use strict';

const scanner = require('./scanner');

module.exports = {
  id: 'ports',
  title: 'Ports',
  order: 4,
  refreshMs: 15000,

  async summary() {
    try {
      const ports = scanner.scanPorts();
      const devServers = ports.filter(p => !p.isSystem);
      const count = devServers.length;

      if (count === 0) {
        return {
          text: 'no servers',
          severity: 'ok',
        };
      }
      return {
        text: count === 1 ? '1 server running' : `${count} servers running`,
        severity: 'ok',
      };
    } catch (err) {
      return {
        text: 'unavailable (' + err.message + ')',
        severity: 'unknown',
      };
    }
  },

  async panel() {
    try {
      const ports = scanner.scanPorts();
      const devCount = ports.filter(p => !p.isSystem).length;

      return {
        available: true,
        title: 'Ports',
        ports,
        totalCount: ports.length,
        devCount,
        statusText: `${ports.length} ports listening (${devCount} dev server${devCount === 1 ? '' : 's'})`,
      };
    } catch (err) {
      return {
        available: false,
        title: 'Ports',
        error: err.message,
        ports: [],
      };
    }
  },

  actions: {
    async kill(args) {
      const pid = args && args.pid;
      const port = args && args.port;

      if (pid == null) {
        return { success: false, error: 'No PID specified' };
      }

      // Re-scan to ensure PID is in the current listening list
      const current = scanner.scanPorts();
      const target = current.find(p => p.pid === pid);

      if (!target) {
        return { success: false, error: `Process with PID ${pid} is no longer listening on any dev port` };
      }

      if (target.isSystem || !target.killable) {
        return { success: false, error: `Process ${target.processName} (PID ${pid}) is a system process and cannot be killed` };
      }

      const result = await scanner.killProcess(pid, port);
      return result;
    },

    async refresh() {
      const ports = scanner.scanPorts();
      return {
        available: true,
        ports,
      };
    },
  },
};
