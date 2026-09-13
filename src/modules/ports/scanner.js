'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFile } = require('child_process');

const DEV_PORT_MIN = 3000;
const DEV_PORT_MAX = 9999;

const SYSTEM_PROCESS_NAMES = new Set([
  'system',
  'system idle process',
  'svchost.exe',
  'csrss.exe',
  'lsass.exe',
  'smss.exe',
  'services.exe',
  'wininit.exe',
  'winlogon.exe',
  'spoolsv.exe',
]);

/**
 * Parse netstat -ano output to find listening TCP sockets in the dev range.
 */
function scanListeningSockets(minPort = DEV_PORT_MIN, maxPort = DEV_PORT_MAX) {
  let stdout = '';
  try {
    stdout = execSync('netstat -ano', {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error('Failed to run netstat: ' + err.message);
  }

  const lines = stdout.split('\r\n');
  const portMap = new Map(); // port -> { port, pid, protocols: Set, addresses: Set }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('LISTENING')) continue;

    const parts = line.trim().split(/\s+/);
    // Format: TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
    if (parts.length >= 5) {
      const proto = parts[0].toUpperCase();
      const localAddr = parts[1];
      const pid = parseInt(parts[4], 10);

      if (isNaN(pid)) continue;

      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon === -1) continue;

      const port = parseInt(localAddr.substring(lastColon + 1), 10);
      if (isNaN(port) || port < minPort || port > maxPort) continue;

      const host = localAddr.substring(0, lastColon);
      let entry = portMap.get(port);
      if (!entry) {
        entry = {
          port,
          pid,
          protocols: new Set([proto]),
          addresses: new Set([host]),
        };
        portMap.set(port, entry);
      } else {
        entry.protocols.add(proto);
        entry.addresses.add(host);
      }
    }
  }

  return Array.from(portMap.values());
}

/**
 * Batch query process information using Get-CimInstance Win32_Process.
 */
function resolveProcesses(pids) {
  const processMap = new Map();
  if (!pids || pids.length === 0) return processMap;

  // Deduplicate and filter out invalid PIDs
  const uniquePids = Array.from(new Set(pids.filter(p => typeof p === 'number' && p >= 0)));
  if (uniquePids.length === 0) return processMap;

  const filter = uniquePids.map(p => `ProcessId = ${p}`).join(' or ');
  const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress"`;

  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 3000,
    }).trim();

    if (!stdout) return processMap;

    const parsed = JSON.parse(stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && typeof p.ProcessId === 'number') {
        processMap.set(p.ProcessId, {
          pid: p.ProcessId,
          name: p.Name || 'unknown',
          commandLine: p.CommandLine || null,
        });
      }
    }
  } catch (err) {
    console.error('[ports] Get-CimInstance resolution error:', err.message);
  }

  return processMap;
}

/**
 * Infer human-recognizable project or script name from a process's command line.
 * Never guesses: returns 'unknown' if not identifiable.
 */
function parseProcessDetails(proc) {
  const name = proc ? proc.name : 'unknown';
  const cmdLine = proc ? proc.commandLine : null;
  const pid = proc ? proc.pid : -1;

  const lowerName = (name || '').toLowerCase();
  const isSystem = pid <= 4 || SYSTEM_PROCESS_NAMES.has(lowerName);

  if (!cmdLine || typeof cmdLine !== 'string') {
    return {
      displayName: name || 'unknown',
      scriptOrServer: 'unknown',
      projectName: 'unknown',
      inferredDir: 'unknown',
      rawCommandLine: 'unknown',
      isSystem,
      killable: !isSystem,
    };
  }

  const trimmed = cmdLine.trim();
  let inferredDir = 'unknown';

  // Look for directory or file path in command line
  const pathMatches = trimmed.match(/[a-zA-Z]:\\[^"'\s;]+/g);
  if (pathMatches && pathMatches.length > 0) {
    for (const p of pathMatches) {
      const lower = p.toLowerCase();
      // Skip runtime executables themselves
      if (
        lower.endsWith('node.exe') ||
        lower.endsWith('electron.exe') ||
        lower.endsWith('python.exe') ||
        lower.endsWith('code.exe')
      ) {
        continue;
      }

      try {
        if (fs.existsSync(p)) {
          const st = fs.statSync(p);
          if (st.isDirectory()) {
            inferredDir = p;
            break;
          } else {
            inferredDir = path.dirname(p);
            break;
          }
        } else {
          inferredDir = path.dirname(p);
          break;
        }
      } catch (e) {}
    }
  }

  let projectName = 'unknown';
  if (inferredDir !== 'unknown') {
    const clean = inferredDir.replace(/\\+/g, '/').replace(/\/+$/, '');
    const parts = clean.split('/');
    projectName = parts[parts.length - 1] || 'unknown';
  }

  // Derive meaningful display name: e.g. "node server.js", "http-server", "vite", "python main.py"
  let scriptOrServer = name;

  if (lowerName.includes('node') || lowerName.includes('electron')) {
    // Check for common dev commands or scripts
    if (trimmed.includes('http-server')) {
      scriptOrServer = 'http-server';
    } else if (trimmed.includes('vite')) {
      scriptOrServer = 'vite';
    } else if (trimmed.includes('ng serve')) {
      scriptOrServer = 'ng serve';
    } else if (trimmed.includes('next dev')) {
      scriptOrServer = 'next dev';
    } else {
      // Find script name ending in .js, .ts, .mjs, .cjs
      const scriptMatch = trimmed.match(/([^\s"'\\]+\.(?:js|ts|mjs|cjs))(?:\s|$|"|')/i);
      if (scriptMatch) {
        scriptOrServer = 'node ' + scriptMatch[1];
      } else {
        scriptOrServer = name;
      }
    }
  } else if (lowerName.includes('python')) {
    const pyMatch = trimmed.match(/([^\s"'\\]+\.py)(?:\s|$|"|')/i);
    if (pyMatch) {
      scriptOrServer = 'python ' + pyMatch[1];
    } else {
      scriptOrServer = 'python';
    }
  }

  return {
    displayName: scriptOrServer,
    scriptOrServer,
    projectName,
    inferredDir,
    rawCommandLine: trimmed,
    isSystem,
    killable: !isSystem,
  };
}

/**
 * Scan listening ports and resolve process/project metadata.
 */
function scanPorts(minPort = DEV_PORT_MIN, maxPort = DEV_PORT_MAX) {
  const sockets = scanListeningSockets(minPort, maxPort);
  if (sockets.length === 0) {
    return [];
  }

  const pids = sockets.map(s => s.pid);
  const processMap = resolveProcesses(pids);

  const results = [];
  for (let i = 0; i < sockets.length; i++) {
    const s = sockets[i];
    const proc = processMap.get(s.pid) || {
      pid: s.pid,
      name: 'unknown',
      commandLine: null,
    };

    const details = parseProcessDetails(proc);

    results.push({
      port: s.port,
      pid: s.pid,
      processName: proc.name,
      displayName: details.displayName,
      scriptOrServer: details.scriptOrServer,
      projectName: details.projectName,
      inferredDir: details.inferredDir,
      commandLine: details.rawCommandLine,
      isSystem: details.isSystem,
      killable: details.killable,
      protocols: Array.from(s.protocols),
      addresses: Array.from(s.addresses),
    });
  }

  // Sort by port number ascending
  results.sort((a, b) => a.port - b.port);
  return results;
}

/**
 * Kill a process and verify that the port is actually freed.
 */
function killProcess(pid, port) {
  return new Promise((resolve) => {
    // Safety guardrail 1: Never kill PID <= 4
    if (pid == null || pid <= 4) {
      return resolve({
        success: false,
        error: 'System process (PID <= 4) cannot be terminated',
      });
    }

    execFile('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).trim();
        if (msg.toLowerCase().includes('access is denied')) {
          return resolve({
            success: false,
            error: 'Access denied. Process may belong to another user or elevated service.',
          });
        }
        if (msg.toLowerCase().includes('not found')) {
          return resolve({
            success: true,
            message: `Process ${pid} already terminated.`,
          });
        }
        return resolve({ success: false, error: msg });
      }

      // Verify whether the port was actually freed
      setTimeout(() => {
        try {
          const current = scanListeningSockets(port, port);
          const stillListening = current.some(s => s.port === port && s.pid === pid);
          if (stillListening) {
            return resolve({
              success: false,
              error: `Process terminated, but port :${port} is still reported as listening.`,
            });
          }
        } catch (e) {}

        resolve({
          success: true,
          message: `Process ${pid} terminated, port :${port} freed.`,
        });
      }, 200);
    });
  });
}

module.exports = {
  DEV_PORT_MIN,
  DEV_PORT_MAX,
  SYSTEM_PROCESS_NAMES,
  scanListeningSockets,
  resolveProcesses,
  parseProcessDetails,
  scanPorts,
  killProcess,
};
