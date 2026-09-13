'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, execFileSync } = require('child_process');

const settingsModule = require('./shell/settings');
const registry = require('./shell/registry');

// App identity set before whenReady to avoid collisions (Req 11, Trap T8)
app.setName('Dev Dashboard');

const WIDTH = 300;
const DEFAULT_HEIGHT = 230;
const MARGIN = 16;

let win = null;
let tray = null;
let settings = null;
let quitting = false;
let shortcutError = null;

// Registry key for autostart - guaranteed separate from sibling's electron.app.Electron
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APP_REG_NAME = 'Dev Dashboard';

// Shortcuts available in tray menu - strictly excludes Ctrl+Alt+C (owned by sibling)
const SHORTCUT_CHOICES = [
  { accelerator: 'Control+Alt+D', label: 'Ctrl+Alt+D' },
  { accelerator: 'Control+Alt+B', label: 'Ctrl+Alt+B' },
  { accelerator: 'Control+Alt+K', label: 'Ctrl+Alt+K' },
  { accelerator: 'Alt+Shift+D', label: 'Alt+Shift+D' },
  { accelerator: 'F10', label: 'F10' },
];

// --- theme ------------------------------------------------------------------

function getResolvedTheme() {
  const theme = settings && settings.theme ? settings.theme : 'dark';
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme === 'light' ? 'light' : 'dark';
}

function getThemePayload() {
  return {
    preference: (settings && settings.theme) || 'dark',
    resolved: getResolvedTheme(),
  };
}

function notifyThemeChanged() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('theme:changed', getThemePayload());
  }
}

function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light' && theme !== 'system') {
    theme = 'dark';
  }
  settingsModule.set('theme', theme);
  settings = settingsModule.get();
  notifyThemeChanged();
}

function toggleTheme() {
  const current = getResolvedTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return getThemePayload();
}

nativeTheme.on('updated', function () {
  if (settings && settings.theme === 'system') {
    notifyThemeChanged();
  }
});

// --- window -----------------------------------------------------------------

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - WIDTH - MARGIN,
    y: area.y + area.height - DEFAULT_HEIGHT - MARGIN,
  };
}

function positionIsOnScreen(x, y) {
  return screen.getAllDisplays().some(function (d) {
    const a = d.workArea;
    return x + WIDTH - 40 > a.x && x + 40 < a.x + a.width &&
           y + 30 > a.y && y + 30 < a.height;
  });
}

function createWindow() {
  let pos;
  if (settings.x != null && settings.y != null && positionIsOnScreen(settings.x, settings.y)) {
    pos = { x: settings.x, y: settings.y };
  } else {
    pos = defaultPosition();
  }

  win = new BrowserWindow({
    width: WIDTH,
    height: DEFAULT_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Dev Dashboard',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(settings.opacity);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('console-message', function (e) {
    if (e.level === 'error' || e.level === 'warning' || process.argv.includes('--dev')) {
      console.log('[renderer:' + e.level + '] ' + e.message + ' (' + e.sourceId + ':' + e.lineNumber + ')');
    }
  });

  win.webContents.on('did-fail-load', function (_e, code, desc, url) {
    console.error('[renderer] failed to load ' + url + ': ' + desc + ' (' + code + ')');
  });

  win.webContents.on('render-process-gone', function (_e, details) {
    console.error('[renderer] process gone: ' + details.reason);
  });

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.on('did-finish-load', function () {
    console.log('[main] did-finish-load');
  });

  win.once('ready-to-show', function () {
    win.show();
    const b = win.getBounds();
    let hwnd64 = '0';
    try {
      const buf = win.getNativeWindowHandle();
      hwnd64 = buf.readBigInt64LE(0).toString();
    } catch (e) {}
    console.log('[main] window shown at ' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height +
      ' | hwnd64 ' + hwnd64 +
      ' | scaleFactor ' + screen.getPrimaryDisplay().scaleFactor +
      ' | workArea ' + JSON.stringify(screen.getPrimaryDisplay().workArea));
    notifyThemeChanged();
    pushSummariesToRenderer();

    if (process.argv.includes('--screenshot')) {
      const panelArg = process.argv.find(a => a.startsWith('--test-panel='));
      if (panelArg) {
        const panelId = panelArg.split('=')[1];
        setTimeout(function () {
          win.webContents.send('navigation:open-module', panelId);
        }, 500);
      }

      setTimeout(async function () {
        try {
          if (process.argv.includes('--scroll-bottom')) {
            await win.webContents.executeJavaScript("document.getElementById('panelBody').scrollTop = 9999;");
            await new Promise(r => setTimeout(r, 200));
          }
          if (process.argv.includes('--test-confirm')) {
            await win.webContents.executeJavaScript(`
              const chk = document.querySelector('.disk-check');
              if (chk) {
                chk.click();
                const btn = document.querySelector('.disk-clean-btn');
                if (btn) btn.click();
              }
            `);
            await new Promise(r => setTimeout(r, 300));
          }
          if (process.argv.includes('--test-port-kill')) {
            await win.webContents.executeJavaScript(`
              const btn = document.querySelector('.port-kill-btn');
              if (btn) btn.click();
            `);
            await new Promise(r => setTimeout(r, 300));
          }
          const img = await win.webContents.capturePage();
          const outPath = path.join(process.cwd(), 'dev-dashboard-screenshot.png');
          fs.writeFileSync(outPath, img.toPNG());
          console.log('[screenshot] wrote ' + outPath + ' (' + img.getSize().width + 'x' + img.getSize().height + ')');
        } catch (err) {
          console.error('[screenshot] failed:', err.message);
        }
        app.quit();
      }, 3500);
    }
  });

  win.on('moved', function () {
    if (!win) return;
    const [x, y] = win.getPosition();
    settingsModule.update({ x: x, y: y });
    settings = settingsModule.get();
  });

  win.on('close', function (e) {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', function () {
    win = null;
  });
}

function showWidget() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  win.show();
  win.focus();
}

function toggleWidget() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isVisible()) {
    win.hide();
  } else {
    showWidget();
  }
}

// --- shortcuts --------------------------------------------------------------

function shortcutLabel(accelerator) {
  if (!accelerator) return 'Off';
  const known = SHORTCUT_CHOICES.find(function (c) { return c.accelerator === accelerator; });
  return known ? known.label : accelerator.replace(/Control/g, 'Ctrl');
}

function applyShortcut(accelerator) {
  globalShortcut.unregisterAll();
  shortcutError = null;

  if (!accelerator) return true;

  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggleWidget);
  } catch (err) {
    shortcutError = err.message;
    console.error('[shortcut] register threw:', err.message);
    return false;
  }

  if (!ok || !globalShortcut.isRegistered(accelerator)) {
    shortcutError = 'already in use by another app';
    console.error('[shortcut] could not register ' + accelerator + ' - ' + shortcutError);
    return false;
  }

  console.log('[shortcut] ' + shortcutLabel(accelerator) + ' toggles Dev Dashboard');
  return true;
}

function setShortcut(accelerator) {
  settingsModule.set('shortcut', accelerator);
  settings = settingsModule.get();
  applyShortcut(accelerator);
}

// --- tray icon & menu -------------------------------------------------------

const TRAY_REPRESENTATIONS = [
  { scaleFactor: 1.0, file: 'tray-16.png' },
  { scaleFactor: 1.25, file: 'tray-20.png' },
  { scaleFactor: 1.5, file: 'tray-24.png' },
  { scaleFactor: 2.0, file: 'tray.png' },
  { scaleFactor: 4.0, file: 'tray-64.png' },
];

function trayIcon() {
  const dir = path.join(__dirname, '..', 'assets');
  const base = nativeImage.createFromPath(path.join(dir, TRAY_REPRESENTATIONS[0].file));
  if (base.isEmpty()) {
    return nativeImage.createEmpty();
  }
  for (let i = 1; i < TRAY_REPRESENTATIONS.length; i++) {
    const rep = TRAY_REPRESENTATIONS[i];
    const repPath = path.join(dir, rep.file);
    if (fs.existsSync(repPath)) {
      base.addRepresentation({
        scaleFactor: rep.scaleFactor,
        buffer: fs.readFileSync(repPath),
      });
    }
  }
  return base;
}

function buildTrayMenu() {
  const summaries = registry.getCachedSummaries();
  const moduleMenuItems = summaries.map(function (m) {
    return {
      label: m.title + ': ' + m.text,
      click: function () {
        showWidget();
        if (win && !win.isDestroyed()) {
          win.webContents.send('navigation:open-module', m.id);
        }
      },
    };
  });

  const template = [
    ...moduleMenuItems,
    { type: 'separator' },
    {
      label: 'Show Dashboard',
      accelerator: settings.shortcut || undefined,
      click: showWidget,
    },
    {
      label: 'Hide Dashboard',
      click: function () { if (win) win.hide(); },
    },
    {
      label: 'Refresh now',
      click: async function () {
        const fresh = await registry.getAllSummaries();
        pushSummariesToRenderer(fresh);
      },
    },
    { type: 'separator' },
    {
      label: shortcutError
        ? 'Shortcut: ' + shortcutLabel(settings.shortcut) + ' (' + shortcutError + ')'
        : 'Shortcut: ' + shortcutLabel(settings.shortcut),
      submenu: SHORTCUT_CHOICES.map(function (choice) {
        return {
          label: choice.label,
          type: 'radio',
          checked: settings.shortcut === choice.accelerator,
          click: function () { setShortcut(choice.accelerator); },
        };
      }).concat([
        { type: 'separator' },
        {
          label: 'Off',
          type: 'radio',
          checked: !settings.shortcut,
          click: function () { setShortcut(null); },
        },
      ]),
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: function (item) {
        settingsModule.set('alwaysOnTop', item.checked);
        settings = settingsModule.get();
        if (win) win.setAlwaysOnTop(item.checked, 'screen-saver');
      },
    },
    {
      label: 'Opacity',
      submenu: [100, 90, 80, 70, 60].map(function (pct) {
        return {
          label: pct + '%',
          type: 'radio',
          checked: Math.round(settings.opacity * 100) === pct,
          click: function () {
            settingsModule.set('opacity', pct / 100);
            settings = settingsModule.get();
            if (win) win.setOpacity(settings.opacity);
          },
        };
      }),
    },
    {
      label: 'Theme',
      submenu: [
        {
          label: 'Dark',
          type: 'radio',
          checked: (settings.theme || 'dark') === 'dark',
          click: function () { setTheme('dark'); },
        },
        {
          label: 'Light',
          type: 'radio',
          checked: settings.theme === 'light',
          click: function () { setTheme('light'); },
        },
        {
          label: 'System',
          type: 'radio',
          checked: settings.theme === 'system',
          click: function () { setTheme('system'); },
        },
      ],
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: loginItemEnabled(),
      click: function (item) { setLoginItem(item.checked); },
    },
    { type: 'separator' },
    {
      label: 'Reset position',
      click: function () {
        const pos = defaultPosition();
        settingsModule.update({ x: pos.x, y: pos.y });
        settings = settingsModule.get();
        if (win) win.setPosition(pos.x, pos.y);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: function () { quitting = true; app.quit(); } },
  ];

  return Menu.buildFromTemplate(template);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Dev Dashboard (Ctrl+Alt+D)');
  tray.on('click', toggleWidget);
  tray.on('right-click', function () {
    tray.popUpContextMenu(buildTrayMenu());
  });
}

// --- autostart (Req 11: safe from sibling collision) -----------------------

function getAutostartCommand() {
  if (app.isPackaged) {
    return `"${process.execPath}"`;
  }
  const electronExe = process.execPath;
  const appPath = path.resolve(__dirname, '..');
  return `"${electronExe}" "${appPath}"`;
}

function loginItemEnabled() {
  try {
    const out = execFileSync('reg.exe', ['query', RUN_KEY, '/v', APP_REG_NAME], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.includes(APP_REG_NAME);
  } catch (err) {
    return false;
  }
}

function setLoginItem(enabled) {
  if (enabled) {
    const cmd = getAutostartCommand();
    execFileSync('reg.exe', ['add', RUN_KEY, '/v', APP_REG_NAME, '/t', 'REG_SZ', '/d', cmd, '/f'], { stdio: 'ignore' });
  } else {
    try {
      execFileSync('reg.exe', ['delete', RUN_KEY, '/v', APP_REG_NAME, '/f'], { stdio: 'ignore' });
    } catch (err) {
      // Key may not exist
    }
  }
}

function autostartFlag() {
  const arg = process.argv.find(function (a) { return a.indexOf('--autostart') === 0; });
  if (!arg) return null;
  const value = arg.split('=')[1];
  return value ? value.toLowerCase() : 'status';
}

// --- IPC handlers -----------------------------------------------------------

function pushSummariesToRenderer(data) {
  const payload = data || registry.getCachedSummaries();
  if (win && !win.isDestroyed()) {
    win.webContents.send('dashboard:update', payload);
  }
}

ipcMain.handle('dashboard:get-summaries', async function () {
  return registry.getCachedSummaries();
});

ipcMain.handle('dashboard:get-panel', async function (_e, id) {
  return registry.getPanelData(id);
});

ipcMain.handle('dashboard:invoke-action', async function (_e, { id, action, args }) {
  return registry.invokeAction(id, action, args);
});

ipcMain.handle('window:set-height', function (_e, height) {
  if (win && !win.isDestroyed()) {
    const clamped = Math.max(200, Math.min(420, Math.round(height)));
    const [w] = win.getSize();
    win.setSize(w, clamped);
  }
});

ipcMain.handle('theme:get', function () {
  return getThemePayload();
});

ipcMain.handle('theme:set', function (_e, theme) {
  setTheme(theme);
  return getThemePayload();
});

ipcMain.handle('theme:toggle', function () {
  return toggleTheme();
});

ipcMain.on('widget:hide', function () {
  if (win) win.hide();
});

ipcMain.on('widget:menu', function () {
  if (tray) tray.popUpContextMenu(buildTrayMenu());
});

// --- startup ----------------------------------------------------------------

const autostartMode = autostartFlag();

if (autostartMode) {
  app.whenReady().then(function () {
    if (autostartMode === 'on') setLoginItem(true);
    else if (autostartMode === 'off') setLoginItem(false);
    else if (autostartMode !== 'status') {
      console.error('Unknown --autostart value: ' + autostartMode + ' (use on, off, or status)');
      app.exit(2);
      return;
    }

    const enabled = loginItemEnabled();
    console.log('Start with Windows: ' + (enabled ? 'ENABLED' : 'disabled'));
    console.log('  Registry key: ' + RUN_KEY + '\\' + APP_REG_NAME);
    console.log('  Command: ' + getAutostartCommand());
    app.exit(0);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    showWidget();
  });

  app.whenReady().then(function () {
    settings = settingsModule.init(app);
    registry.loadModules();

    createTray();
    createWindow();

    registry.startPolling(function (freshSummaries) {
      pushSummariesToRenderer(freshSummaries);
    });

    applyShortcut(settings.shortcut);
  });

  app.on('window-all-closed', function () {
    // Stays in tray until explicit quit
  });

  app.on('before-quit', function () {
    quitting = true;
  });

  app.on('will-quit', function () {
    globalShortcut.unregisterAll();
    registry.stopTimers();
  });
}
