'use strict';

// Electron ships its own postinstall step that downloads the ~250 MB runtime
// binary. npm decides whether to run a dependency's install script from the
// `hasInstallScript` flag in package-lock.json -- and that flag is missing from
// electron's lockfile entry, so npm silently skips it. The result on a fresh
// clone is a complete `npm install` with no electron.exe and an `npm start`
// that fails.
//
// So run it ourselves when the binary is absent. Idempotent (a no-op once the
// binary is there) and never fatal -- a failure here prints instructions rather
// than breaking the whole install.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');

// Nothing to do if electron was not installed at all (--omit=dev, for example).
if (!fs.existsSync(electronDir)) process.exit(0);

function binaryPresent() {
  try {
    const rel = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim();
    if (!rel) return false;
    return fs.existsSync(path.join(electronDir, 'dist', rel));
  } catch (err) {
    return false;
  }
}

if (binaryPresent()) process.exit(0);

const installer = path.join(electronDir, 'install.js');
if (!fs.existsSync(installer)) process.exit(0);

console.log('[postinstall] Electron binary missing - downloading it now (~250 MB, one time).');

const result = spawnSync(process.execPath, [installer], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (result.error || result.status !== 0 || !binaryPresent()) {
  console.error('');
  console.error('[postinstall] Could not install the Electron binary automatically.');
  console.error('              Run this, then try again:');
  console.error('');
  console.error('                  node node_modules/electron/install.js');
  console.error('');
  // Deliberately exit 0: a warning the user can act on beats a failed install.
  process.exit(0);
}

console.log('[postinstall] Electron binary installed.');
