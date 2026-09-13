'use strict';

// VS Code's integrated terminal and extension host export ELECTRON_RUN_AS_NODE=1.
// Inherited, it makes the Electron binary behave as plain Node, so require('electron')
// hands back a path string instead of the API and the app dies on startup. Strip it
// (and the rest of VS Code's Electron plumbing) before spawning.
const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

// Normally launch the app itself ('.'); a .js argument runs that script under
// Electron instead, which is how the icon generator gets a Chromium to work in.
const passed = process.argv.slice(2);
const args = passed.length && passed[0].endsWith('.js') ? passed : ['.'].concat(passed);

const child = spawn(electronPath, args, {
  cwd: path.join(__dirname, '..'),
  env: env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', function (code) {
  process.exit(code == null ? 0 : code);
});

child.on('error', function (err) {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});
