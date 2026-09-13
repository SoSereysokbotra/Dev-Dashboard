'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  x: null,
  y: null,
  alwaysOnTop: true,
  opacity: 1,
  theme: 'dark',
  // Default hotkey toggles the widget.
  // Ctrl+Alt+D is distinct and avoids collision with the sibling's Ctrl+Alt+C.
  shortcut: 'Control+Alt+D',
};

let settingsPath = null;
let currentSettings = Object.assign({}, DEFAULT_SETTINGS);

function init(app) {
  // Use %APPDATA%/dev-dashboard/settings.json
  const dir = path.join(app.getPath('appData'), 'dev-dashboard');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      // Best effort
    }
  }
  settingsPath = path.join(dir, 'settings.json');
  return load();
}

function load() {
  if (!settingsPath) return currentSettings;
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    currentSettings = Object.assign({}, DEFAULT_SETTINGS, parsed);
  } catch (err) {
    // Torn reads or missing file: fall back to defaults safely.
    currentSettings = Object.assign({}, DEFAULT_SETTINGS);
  }
  return currentSettings;
}

function save() {
  if (!settingsPath) return;
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2), 'utf8');
  } catch (err) {
    // Do not interrupt the user on write failure.
  }
}

function get() {
  return currentSettings;
}

function set(key, value) {
  currentSettings[key] = value;
  save();
  return currentSettings;
}

function update(partial) {
  Object.assign(currentSettings, partial);
  save();
  return currentSettings;
}

module.exports = {
  DEFAULT_SETTINGS,
  init,
  load,
  save,
  get,
  set,
  update,
};
