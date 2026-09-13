# Dev Dashboard

A standalone Windows desktop widget: one small always-on-top window hosting four local developer tools — Repos, Cost / Project, Disk, and Ports.

Built with Electron, plain JavaScript, no framework, fully offline, never touches credentials.

## Features

- **Small footprint**: 300px wide, ~230px tall frameless translucent window.
- **Always on top**: Floats above full-screen editors and browsers.
- **Global shortcut**: `Ctrl+Alt+D` toggles the dashboard from anywhere.
- **Keyboard-first navigation**:
  - `1`–`4`: Open tool module
  - `Esc`: On panel returns to home; on home hides to system tray
- **System Tray**: Live summaries, quick module switching, shortcut picker, auto-start toggle, and theme switcher.
- **Offline & Safe**: Zero network calls, zero credential inspection.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+D` | Toggle dashboard window |
| `1` | Open Repos module |
| `2` | Open Cost / Project module |
| `3` | Open Disk module |
| `4` | Open Ports module |
| `Esc` | Return to home screen / hide window |

## Getting Started

```powershell
# Install dependencies (downloads Electron runtime)
npm install

# Generate tray icon PNGs (if needed)
npm run icon

# Start Dev Dashboard
npm start

# Enable auto-start with Windows
npm run autostart:on
```

## Architecture

```
dev-dashboard/
  scripts/
    launch.js           Strips ELECTRON_RUN_AS_NODE (VS Code environment fix)
    postinstall.js      Downloads Electron runtime if skipped by npm
    make-tray-icon.js   Generates DPI-scaled tray icons
  src/
    main.js             Window lifecycle, tray menu, shortcut, autostart
    preload.js          Secure IPC bridge
    shell/
      registry.js       Module discovery, safe summary polling, panel routing
      settings.js       Persistent preferences at %APPDATA%/dev-dashboard
    modules/
      repos/            Git repositories status (Phase 2)
      cost/             Claude Code cost attribution (Phase 3)
      disk/             Cleanable dependencies (Phase 4)
      ports/            Listening dev servers (Phase 5)
    renderer/
      index.html        Home screen and panel views (Strict CSP)
      styles.css        Visual design and dark/light themes
      renderer.js       Key handling and DOM updates
```
