'use strict';

const fs = require('fs');
const path = require('path');

const modules = new Map();
const cachedSummaries = new Map();
let timers = [];
let updateCallback = null;

function loadModules(modulesDir) {
  modules.clear();
  cachedSummaries.clear();
  stopTimers();

  const baseDir = modulesDir || path.join(__dirname, '..', 'modules');
  if (!fs.existsSync(baseDir)) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modPath = path.join(baseDir, entry.name, 'index.js');
    if (!fs.existsSync(modPath)) continue;

    try {
      // Clear require cache in case of reloads
      delete require.cache[require.resolve(modPath)];
      const mod = require(modPath);

      if (!mod || !mod.id || !mod.title || typeof mod.order !== 'number') {
        console.warn('[registry] skipping invalid module at ' + modPath);
        continue;
      }

      modules.set(mod.id, mod);
      cachedSummaries.set(mod.id, {
        id: mod.id,
        title: mod.title,
        order: mod.order,
        text: 'unavailable',
        severity: 'unknown',
      });

      if (typeof mod.setScanCompleteListener === 'function') {
        mod.setScanCompleteListener(async function () {
          await fetchSummaryForModule(mod);
          if (updateCallback) {
            updateCallback(getCachedSummaries());
          }
        });
      }
    } catch (err) {
      console.error('[registry] failed to load module at ' + modPath + ':', err.message);
    }
  }

  return getSortedModules();
}

function getSortedModules() {
  return Array.from(modules.values()).sort((a, b) => a.order - b.order);
}

function getModule(id) {
  return modules.get(id);
}

async function fetchSummaryForModule(mod) {
  try {
    const res = await Promise.resolve(mod.summary());
    const summary = {
      id: mod.id,
      title: mod.title,
      order: mod.order,
      text: (res && typeof res.text === 'string') ? res.text : 'unavailable',
      severity: (res && typeof res.severity === 'string') ? res.severity : 'unknown',
    };
    cachedSummaries.set(mod.id, summary);
    return summary;
  } catch (err) {
    // T6 / Req 6: A throwing module must NEVER take down the app or other modules.
    console.error('[registry] module ' + mod.id + ' summary() threw:', err.message);
    const fallback = {
      id: mod.id,
      title: mod.title,
      order: mod.order,
      text: 'unavailable',
      severity: 'unknown',
      error: err.message,
    };
    cachedSummaries.set(mod.id, fallback);
    return fallback;
  }
}

async function getAllSummaries() {
  const sorted = getSortedModules();
  const promises = sorted.map(fetchSummaryForModule);
  return Promise.all(promises);
}

function getCachedSummaries() {
  return getSortedModules().map(m => cachedSummaries.get(m.id) || {
    id: m.id,
    title: m.title,
    order: m.order,
    text: 'unavailable',
    severity: 'unknown',
  });
}

function startPolling(onUpdate) {
  stopTimers();
  updateCallback = onUpdate;

  // Initial immediate fetch for all modules
  getAllSummaries().then(summaries => {
    if (updateCallback) updateCallback(summaries);
  });

  // Start individual timers per module refreshMs
  for (const mod of modules.values()) {
    const ms = Math.max(mod.refreshMs || 60000, 3000);
    const timer = setInterval(async function () {
      await fetchSummaryForModule(mod);
      if (updateCallback) {
        updateCallback(getCachedSummaries());
      }
    }, ms);
    timers.push(timer);
  }
}

function stopTimers() {
  for (const t of timers) clearInterval(t);
  timers = [];
}

async function getPanelData(id) {
  const mod = modules.get(id);
  if (!mod) {
    return { error: 'Module not found: ' + id };
  }
  if (typeof mod.panel !== 'function') {
    return { title: mod.title, items: [], statusText: 'No panel available' };
  }
  try {
    return await Promise.resolve(mod.panel());
  } catch (err) {
    console.error('[registry] module ' + id + ' panel() threw:', err.message);
    return { title: mod.title, error: err.message, items: [] };
  }
}

async function invokeAction(id, actionName, args) {
  const mod = modules.get(id);
  if (!mod || !mod.actions || typeof mod.actions[actionName] !== 'function') {
    throw new Error('Action ' + actionName + ' not found on module ' + id);
  }
  return Promise.resolve(mod.actions[actionName](args));
}

module.exports = {
  loadModules,
  getSortedModules,
  getModule,
  fetchSummaryForModule,
  getAllSummaries,
  getCachedSummaries,
  startPolling,
  stopTimers,
  getPanelData,
  invokeAction,
};
