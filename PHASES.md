# Build Plan — Dev Dashboard

A phased plan for a **new, standalone** Windows desktop app: one small window
hosting four local developer tools.

```
┌──────────────────────────────────────────┐
│ ● Dev Dashboard                  ⋮   ✕   │
│                                          │
│  1  Repos             22 need attention  │
│  2  Cost / Project    jobfit  $84        │
│  3  Disk              18.4 GB to clean   │
│  4  Ports             3 servers running  │
│                                          │
│  press 1–4 to open  ·  Esc to go back    │
└──────────────────────────────────────────┘
```

**Read this whole file before writing any code.** It is written so that a
developer or AI assistant with no memory of earlier work can pick up any single
phase and finish it correctly.

---

## Relationship to the Claude Usage widget

This project is a **sibling** of `D:\Claude Usage`
(`github.com/SoSereysokbotra/claude-usage-widget`), which is finished and stays
exactly as it is.

| | Claude Usage | Dev Dashboard (this project) |
|---|---|---|
| Purpose | Claude Code session/weekly usage | Repos, cost per project, disk, ports |
| Repo | `claude-usage-widget` | its own — see Phase 1 |
| Folder | `D:\Claude Usage` | `D:\dev-dashboard` |
| Shortcut | `Ctrl+Alt+C` | **`Ctrl+Alt+D`** — must not collide |
| Network | one call to Anthropic's usage endpoint | **none, ever** |
| Credentials | reads the Claude Code OAuth token | **never touches them** |

**Rules about the sibling:**

1. **Never modify `D:\Claude Usage`.** Not a file, not a commit.
2. **Copy, do not import.** Several of its files solve problems this project will
   hit identically (see each phase for which). Copy them into this repo. Do not
   `require` across folders, symlink, or add it as a dependency — the two
   projects must build and run with the other absent.
3. Both run at once on the developer's machine. That means **two tray icons and
   two global shortcuts**. The developer chose this deliberately. Pick a tray
   icon that is visibly different from the Claude symbol.

---

## How to use this file

- Phases are ordered. **Do not start a phase until every box in the phases
  before it is ticked** — later phases assume earlier ones exist.
- Do **one phase per session.** Do not combine phases.
- Every phase ends with acceptance criteria, a verification step whose real
  output you must paste, and a commit message.
- When a phase is finished, tick its boxes in this file and commit that change
  with the work.

## Rules for anyone working on this project

1. **Verify, do not assume.** Every number in this file was measured on the
   developer's machine. If you change behaviour that depends on one, re-measure
   it and update this file.
2. **Never invent data.** If a value is unavailable, the UI says so. No zeros
   standing in for unknowns. A wrong number is worse than a blank.
3. **This app is offline.** It opens no sockets and reads no credentials. If a
   phase seems to need either, stop and ask — it does not.
4. **Windows only.** See [Platform support](#platform-support). Do not add
   macOS or Linux code paths speculatively.
5. **No new runtime dependencies** without a stated reason. The target is
   exactly one, `electron`, dev-only.
6. **Writing to disk or killing processes happens in exactly two places** —
   Phase 4's deleter and Phase 5's kill button. Both confirm first, both report
   the real outcome. Nothing else in this app writes anything outside its own
   settings file.
7. **Test with the real data on disk**, not fixtures, unless testing a failure
   path that cannot be produced naturally.

---

## Environment (measured 2026-09-09)

| Thing | Value |
|---|---|
| OS | Windows 11 Home Single Language, 10.0.26200 |
| Display scaling | 1.25 (workArea 1536×816) |
| Node | v24.19.0 |
| npm | 11.11.0 |
| Electron | ^44.3.0 (match the sibling) |
| Rust | **not installed** — do not propose Tauri |
| Git | on PATH |

---

## Known traps

Every one of these cost real debugging time in the sibling project. Read them
before you hit them.

### T1 — `ELECTRON_RUN_AS_NODE` breaks startup

VS Code's terminal and extension host export `ELECTRON_RUN_AS_NODE=1`. Inherited,
the Electron binary runs as plain Node, `require('electron')` returns a **path
string** instead of the API, and the app dies with
`TypeError: Cannot read properties of undefined (reading 'handle')`.

**Always launch with `npm start`**, never `electron .`. The launcher script
strips the variable. To run any other script under Electron, pass it to the same
launcher: `node scripts/launch.js path/to/script.js`.

### T2 — npm silently skips Electron's binary download

npm decides whether to run a dependency's install script from `hasInstallScript`
in `package-lock.json`. Electron's entry **lacks it**, so `npm install` reports
success and installs no runtime. `scripts/postinstall.js` detects and fixes this.
Do not delete it. If the binary is missing:
`node node_modules/electron/install.js`.

### T3 — Transcripts contain massive duplication

Resumed and forked Claude Code sessions replay history into new files. Measured:
**18,290 duplicates out of 28,732** assistant records. Always dedupe on
`message.id + "|" + requestId`. (Phase 3 only.)

### T4 — `nativeImage` cannot decode WebP

Given a `.webp`, `nativeImage.createFromPath()` returns an **empty image** with no
error — the tray silently shows nothing. Pre-render icons to PNG through
Chromium (`scripts/make-tray-icon.js`, copied from the sibling).

### T5 — The renderer's CSP blocks inline `style` attributes

If `index.html` sets a CSP without `unsafe-inline` (it should), writing
`style="width:40%"` into HTML is **blocked silently** — bars render empty. Set
styles through CSSOM after insertion: `el.style.width = '40%'`.

### T6 — `globalShortcut.register` fails two different ways

- Combination already owned by another app → returns **`false`** (no throw).
- Malformed accelerator → **throws**.
- OS-reserved (e.g. `Control+Alt+Delete`) → returns **`false`**.

Handle both and surface the failure in the tray menu. Confirm ownership with
`globalShortcut.isRegistered()` afterwards. **Claude Usage already owns
`Ctrl+Alt+C`** — do not offer it here.

### T7 — Screenshots of the widget need `PrintWindow`, not `CopyFromScreen`

The window is transparent and DWM-composited. GDI `CopyFromScreen` captures the
desktop **behind** it. Use `PrintWindow` with flag `2` (`PW_RENDERFULLCONTENT`),
and make the capturing process DPI-aware first
(`SetProcessDpiAwarenessContext(-4)`) or the bitmap is undersized and clipped.

### T8 — Auto-start points into `node_modules`

Unpackaged, `app.setLoginItemSettings` must receive `path: process.execPath` and
`args: [appDirectory]`, or Windows launches Electron's default window instead of
the app. The registry key lands as `electron.app.Electron` — **the same key the
sibling uses.** Two unpackaged Electron apps overwrite each other's auto-start.
See Phase 1 requirement 11 for the fix.

### T9 — Windows paths are not strings you can compare

The same folder appears as `D:\Year2\Jobfit`, `d:/year2/jobfit` and
`D:\\Year2\\Jobfit` across different sources. Normalise (lower-case, forward
slashes, no trailing slash) before grouping or comparing, or one project becomes
three.

---

## Data reference

### A. Transcripts — `~/.claude/projects/<slug>/<session-id>.jsonl` (Phase 3)

One JSON object per line. Records with `"type":"assistant"` carry usage:

```jsonc
{
  "type": "assistant",
  "timestamp": "2026-09-09T08:23:02.248Z",
  "requestId": "req_011Ces…",
  "cwd": "D:\\Claude Usage",        // ← project attribution
  "gitBranch": "HEAD",
  "sessionId": "fb8fc588-…",
  "message": {
    "id": "msg_011Ces…",
    "model": "claude-opus-5",       // "<synthetic>" = local, never billed
    "usage": {
      "input_tokens": 2,
      "output_tokens": 773,
      "cache_read_input_tokens": 43241,
      "cache_creation": { "ephemeral_5m_input_tokens": 0,
                          "ephemeral_1h_input_tokens": 864 }
    }
  }
}
```

Measured scale: 79 files, 281 MB, **96 distinct `cwd` values**.
Cold scan **1.3 s**; incremental rescan **11 ms** (read from last byte offset).

This is the **only** Claude-related data this project reads. It never reads
`~/.claude.json`, never reads `~/.claude/.credentials.json`, never calls any
endpoint.

### B. Pricing (USD per million tokens) (Phase 3)

| Model | Input | Output |
|---|---|---|
| `claude-opus-5`, `claude-opus-4-8/4-7/4-6` | 5 | 25 |
| `claude-fable-5-1`, `claude-fable-5` | 10 | 50 |
| `claude-sonnet-5` | 2 | 10 |
| `claude-sonnet-4-6` | 3 | 15 |
| `claude-haiku-4-5` | 1 | 5 |

Cache multipliers on the input rate: read **0.1×**, 5-minute write **1.25×**,
1-hour write **2×**. Unknown model → fall back by tier name (`opus`, `sonnet`,
`haiku`) rather than silently costing zero.

These figures are **API-equivalent value**, not money charged. On a subscription
the developer is not billed this. Label it as such in any UI.

### C. Git repositories on `D:\` (Phase 2)

Measured: **81 repositories** (depth ≤ 4), **22 with uncommitted changes, 3 with
unpushed commits, 26 untouched for over 90 days.**

### D. Dependency folders on `D:\` (Phase 4)

Measured: **82 `node_modules` directories**, 135 manifests
(`package.json` / `requirements.txt` / `pom.xml`).

---

## Phase 1 — Scaffold the shell

**Goal:** a running, empty dashboard — window, tray, shortcut, auto-start, home
screen with four rows all reading `unavailable` — with the module contract in
place so Phases 2–5 each add one folder.

### What to copy from the sibling

These solve problems this project hits identically. Copy the files, keep the
comments, change the app name.

| From `D:\Claude Usage` | Purpose | Trap |
|---|---|---|
| `scripts/launch.js` | strips `ELECTRON_RUN_AS_NODE` | T1 |
| `scripts/postinstall.js` | installs the Electron binary npm skips | T2 |
| `scripts/make-tray-icon.js` | renders WebP/SVG/PNG → tray PNG sizes | T4 |
| `src/main.js` — the window, tray, `globalShortcut`, `setLoginItemSettings`, settings load/save, and theme sections | proven, tested | T6, T8 |
| `src/renderer/styles.css` | visual language, so the two apps look related | T5 |
| `.gitignore` | already blocks credentials, logs, screenshots | — |

Do **not** copy `usage.js`, `live.js`, `calibration.js` or `view.js` — this
project has no usage percentages and no live fetch.

### Target structure

```
dev-dashboard/
  package.json          name: "dev-dashboard"
  .gitignore
  PHASES.md             this file
  README.md
  assets/               tray icon source + generated PNGs
  scripts/
    launch.js
    postinstall.js
    make-tray-icon.js
  src/
    main.js             window, tray, shortcut, auto-start, routing
    preload.js          contextBridge IPC surface
    shell/
      registry.js       loads modules, calls summary() on schedule
      settings.js       load/save %APPDATA%/dev-dashboard/settings.json
    modules/
      repos/            Phase 2
      cost/             Phase 3
      disk/             Phase 4
      ports/            Phase 5
    renderer/
      index.html        home screen + panel host, with CSP
      styles.css
      renderer.js       key handling, rendering
```

### The module contract

Every module is a folder under `src/modules/` exporting exactly this. Do not
extend it without updating this file.

```js
module.exports = {
  id: 'repos',              // unique, lowercase, equals the folder name
  title: 'Repos',           // shown on the home screen and tray menu
  order: 1,                 // home-screen position and number key (1-9)
  refreshMs: 60000,         // how often summary() is polled

  // One line for the home screen. Must return quickly and must never throw.
  // { text: '22 need attention', severity: 'ok'|'warn'|'high'|'critical'|'unknown' }
  async summary() { … },

  // Full data for the module's page. May be slower; only called when visible.
  async panel() { … },

  // Optional. Actions the panel can invoke, e.g. { openFolder, remove, kill }.
  // Anything that writes or kills MUST confirm inside the action.
  actions: { … },
};
```

### Requirements

1. `Ctrl+Alt+D` toggles the window. Default; changeable in the tray menu from a
   fixed list that **excludes `Ctrl+Alt+C`** (T6).
2. The window opens on the **home screen**. Number keys `1`–`4` open the module
   with that `order`. `Esc` on a panel returns home; `Esc` on home hides.
3. Key hints are printed on the home screen. The user must never have to
   remember them.
4. The tray menu lists every registered module by `title`, so the app is fully
   usable with the mouse alone.
5. Home is compact (~230 px tall); panels may grow to 420 px. Width stays 300 px.
6. A module that throws in `summary()` shows `unavailable` on its row. **It must
   not break the home screen or any other module.** Prove it with a deliberately
   broken stub before Phase 2 (see Verify).
7. Only the visible page polls `panel()`. Background modules refresh `summary()`
   at their own `refreshMs`.
8. Frameless, transparent, always-on-top (`'screen-saver'` level), bottom-right
   by default, draggable by the title bar, position remembered. Closing with ✕
   hides to the tray; quit is in the tray menu. Single-instance lock.
9. Settings at `%APPDATA%\dev-dashboard\settings.json`. Torn reads are normal —
   catch parse errors, fall back to defaults.
10. `index.html` sets a CSP with no `unsafe-inline` (T5).
11. **Auto-start must not collide with the sibling.** Both unpackaged apps would
    register as `electron.app.Electron` (T8). Set `app.setName('Dev Dashboard')`
    **before** `app.whenReady()` and verify the registry key differs from the
    sibling's. If Electron still produces the same key, write the `Run` entry
    directly under a distinct name and document it.
12. A distinct tray icon. Not the Claude symbol.
13. `npm run autostart:on|off|status` as in the sibling.

### Acceptance criteria

- [x] `git clone` → `npm install` → `npm start` works on a clean copy; the
      Electron binary is present after install (T2)
- [x] Home screen shows four rows, all `unavailable`, no renderer errors
- [x] `Ctrl+Alt+D` toggles; `Ctrl+Alt+C` still toggles Claude Usage and not this
- [x] A stub module whose `summary()` throws shows `unavailable`; the other
      three rows still render
- [x] Tray menu lists the four modules and opens them
- [x] `npm run autostart:on` registers under a key **different** from the
      sibling's `electron.app.Electron` — paste both registry values
- [x] Both apps run at the same time, each with its own tray icon

### Verify

```powershell
# both shortcuts, both apps
npm start
# press Ctrl+Alt+D  -> this app toggles
# press Ctrl+Alt+C  -> Claude Usage toggles, this one does not

# auto-start keys must differ
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" |
  Select-Object -Property *electron*
```

### Commit

```
chore: scaffold the dashboard shell

One window, tray icon and Ctrl+Alt+D shortcut hosting modules behind a home
screen keyed 1-4, with the hints printed so nothing has to be memorised. Each
module exposes a summary line and a panel; one throwing cannot take down the
others. Launcher, postinstall and icon scripts are copied from the sibling
claude-usage-widget, where each fixed a real startup failure. Registers
auto-start under its own name so the two apps do not overwrite each other.
```

---

## Phase 2 — Repos (module 1)

**Goal:** show which local git repositories have unsaved or unpushed work.

### Why

Measured: **81 repositories, 22 with uncommitted changes, 3 with unpushed
commits, 26 untouched for over 90 days.** The developer cannot tell which without
checking each by hand.

### Data source

Local `.git` directories. No network. Scan roots configurable; default `D:\`,
depth 4. Per repository, via `git -C <path> …`:

| Value | Command |
|---|---|
| changed files | `status --porcelain` (count lines) |
| unpushed commits | `rev-list --count @{u}..HEAD` |
| behind remote | `rev-list --count HEAD..@{u}` |
| last commit time | `log -1 --format=%ct` |
| branch | `rev-parse --abbrev-ref HEAD` |

### Requirements

1. **Do not block the UI.** 81 repos × 5 git calls is slow. Batch with yields
   and cache results; `summary()` returns the cached count immediately.
2. **Cache by mtime.** Re-scan a repo only when its `.git` directory has changed
   since last look.
3. **Rank by what needs attention**, not alphabetically: unpushed first, then
   uncommitted, then behind-remote.
4. **Handle without crashing**, each verified:
   - no upstream (`@{u}` fails) — must **not** report "0 unpushed"
   - detached HEAD
   - empty repo with no commits
   - `.git` as a file (worktree/submodule) rather than a directory
   - repo on a disconnected drive
5. `git` missing from PATH → module reports `unavailable (git not found)`.
6. Summary: `22 need attention` / `warn`; `all clean` / `ok`.
7. Panel: at most 20 repos, worst first, plus a count of the remainder.
8. Action `openFolder` → `shell.openPath`.
9. **Read-only. Never run a git command that writes** — no commit, push,
   checkout, reset, clean, stash. Ever.

### Files

| Action | File |
|---|---|
| Create | `src/modules/repos/index.js` — contract + summary |
| Create | `src/modules/repos/scanner.js` — discovery, git calls, cache |
| Create | `src/modules/repos/panel.js` |
| Modify | `src/renderer/renderer.js` — repos panel |

### Acceptance criteria

- [x] Finds ≥ 80 repositories on `D:\`
- [x] Counts match `git status` run by hand in 3 spot-checked repos
- [x] First full scan < 10 s; cached rescan < 500 ms
- [x] Home screen responsive during the first scan
- [x] A repo with no upstream is not reported as "0 unpushed"
- [x] With `git` unavailable the module reports it and the app still runs
- [x] `grep -rnE "git .*(commit|push|checkout|reset|clean|stash)" src/modules/repos/` → nothing

### Verify

```bash
# ground truth: count dirty and unpushed repos independently, then compare
for g in $(find /d -maxdepth 4 -name .git -type d); do
  r=$(dirname "$g"); git -C "$r" status --porcelain | grep -q . && echo "dirty $r"
done | wc -l
npm start   # the module's number must match
```

### Commit

```
feat: add Repos module

Surfaces which local repositories hold unsaved or unpushed work: 81 repos on
this machine, 22 dirty, and no way to see it without checking each by hand.
Scans cache by .git mtime because 81 repos times five git calls is far too slow
per refresh. Strictly read-only; no git command that writes exists in the module.
```

---

## Phase 3 — Cost / Project (module 2)

**Goal:** attribute Claude Code usage to the project it was spent on.

### Why

The Claude Usage widget reports one total. Every assistant record carries a
`cwd`, so that total can be split by project — a breakdown that exists nowhere
else. **Confirmed: 96 distinct `cwd` values in the transcripts.**

### Data source

Transcripts (§A). No network, no credentials. **This is the only place this
project reads anything Claude-related.**

### Requirements

1. **Write this project's own scanner.** Copy the parsing logic from the
   sibling's `src/usage.js` (`parseChunk`, `refreshFileCache`, the incremental
   byte-offset read, the dedupe key) — it has been measured and tested. Keep
   the comments explaining why. Do not import it across repos.
2. Dedupe on `message.id + "|" + requestId` (T3). Skip `model === "<synthetic>"`.
3. Retain `cwd` per entry. **Normalise it before grouping** (T9).
4. Display the folder name, not the full path (`jobfit-backend`, not
   `D:\Year2\Jobfit\jobfit-backend`). Full path in the tooltip.
5. Periods: today / last 7 days. There is no reset-aligned window here — this
   project does not know the subscription's reset time and must not pretend to.
6. Cost per §B. Label every figure **"API-equivalent value"**.
7. Summary: top project and its 7-day figure — `jobfit-backend $84` / `ok`.
8. Panel: top 10 projects with bars, plus an `other` row, plus the total.
9. If `~/.claude/projects` does not exist → `unavailable (no Claude Code data)`.

### Files

| Action | File |
|---|---|
| Create | `src/modules/cost/index.js` |
| Create | `src/modules/cost/scanner.js` — incremental JSONL reader, dedupe, pricing |
| Create | `src/modules/cost/panel.js` — grouping, normalisation, display names |
| Modify | `src/renderer/renderer.js` — cost panel |

### Acceptance criteria

- [x] Per-project 7-day totals sum to the scanner's 7-day total (±$0.01)
- [x] Paths differing only by case or slash direction group as one project
- [x] Cold scan < 3 s; cached refresh < 100 ms
- [x] Duplicate count roughly matches the sibling's (~18k of ~29k) — proves the
      dedupe key is right
- [x] `<synthetic>` excluded
- [x] "API-equivalent value" appears wherever a dollar figure does
- [x] `grep -rn "credentials\|oauth\|fetch(" src/modules/cost/` → nothing

### Verify

```bash
node -e "
const s = require('./src/modules/cost/scanner');
// print: files, unique messages, duplicates skipped, per-cwd totals, grand total
"
```

### Commit

```
feat: add Cost / Project module

Every Claude Code assistant record carries the cwd it was produced in, so one
weekly total can be split across the 96 project paths in the transcripts.
Grouping normalises case and slash direction first, since Windows yields the
same folder written several ways. The scanner is copied from claude-usage-widget
where its dedupe and incremental read were measured; this project reads
transcripts only and never touches credentials or the network.
```

---

## Phase 4 — Disk (module 3)

**Goal:** find and safely remove rebuildable dependency folders.

### Why

Measured: **82 `node_modules` directories** on `D:\`, many from Year 1 coursework
untouched for months. Rebuildable from a lockfile.

### Data source

Filesystem only. Target names: `node_modules`, `.venv`, `venv`, `__pycache__`,
`target`, `dist`, `build`, `.next`, `.nuxt`.

### Requirements

1. **Size calculation is expensive.** Compute lazily and cache; never on the
   home screen's refresh path. The summary may show a cached total with its age.
2. **Rank by safety and show the evidence:**
   - lockfile present (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
     `poetry.lock`, `Pipfile.lock`) → restorable
   - project's own files untouched for N days → likely inactive
   - **default-select nothing.** The user ticks each item deliberately.
3. **Deleting is one of two writing operations in this app.** Therefore:
   - always confirm, showing exact paths and total size
   - never delete anything without a lockfile unless explicitly overridden
   - never follow symlinks or junctions — verified with a test junction
   - never delete outside the configured scan roots
   - never delete a path containing `.git`
4. **Windows long paths.** `node_modules` routinely exceeds `MAX_PATH` (260) and
   naive deletion fails part-way, leaving a broken tree. Use `\\?\`-prefixed
   paths or a proven recursive remove, and **verify the directory is gone**
   afterwards. Report partial failures honestly.
5. Report what was actually freed, **re-measured** — not the estimate.
6. Summary: `18.4 GB to clean` / `ok` (opportunity, not a problem).

### Files

| Action | File |
|---|---|
| Create | `src/modules/disk/index.js` |
| Create | `src/modules/disk/scanner.js` — find, size, safety ranking |
| Create | `src/modules/disk/remove.js` — long-path-safe deletion |
| Modify | `src/renderer/renderer.js` — disk panel, checkboxes, confirm |

### Acceptance criteria

- [x] Finds ≥ 80 `node_modules` on `D:\`
- [x] Sizes match `du -sm` on 3 spot-checked folders
- [x] Nothing selected by default
- [x] Deletion confirms with paths and total size
- [x] A folder nested > 260 characters deletes completely — verified by
      creating one under the scratch directory first
- [x] A test junction is skipped, not followed
- [x] Freed space is re-measured after deletion
- [x] An active project's `node_modules` is flagged "in use", not offered as safe

### Verify

```powershell
# deliberately deep path, then remove through the module and confirm it is gone
$p = "$env:TEMP\deep"; 1..30 | % { $p = "$p\aaaaaaaaaaaaaaaaaaaa" }
New-Item -ItemType Directory -Force $p | Out-Null
# delete via the module, then:
Test-Path "$env:TEMP\deep"   # must be False
```

### Commit

```
feat: add Disk module for rebuildable dependency folders

82 node_modules directories on this machine, most from finished coursework.
Ranks candidates by whether a lockfile makes them restorable and how long the
project has been idle, selects nothing by default, and confirms with explicit
paths before removing. Deletion is long-path safe: node_modules routinely
exceeds MAX_PATH and a naive recursive remove fails half way.
```

---

## Phase 5 — Ports (module 4)

**Goal:** show which local ports are busy, by which process, from which project.

### Why

The developer runs Angular, Node and Firebase emulators at once and hits
`port already in use` with no way to tell what holds it.

### Data source

Windows only, no network:

- `netstat -ano` → port → PID
- PID → executable and command line via `Get-CimInstance Win32_Process`
  (avoid `wmic`, deprecated on Windows 11)
- PID → working directory: **not directly available on Windows.** Infer from the
  command line where possible; otherwise say `unknown`. Do not guess.

### Requirements

1. Only listening ports in the dev range (default 3000–9999), configurable.
2. Resolve to something meaningful: `node.exe` alone is useless — show the
   script or project from the command line when readable.
3. **Killing is the other writing operation in this app.** Confirm first,
   showing PID and command line. Never kill PID 0/4 or anything not in the
   resolved list.
4. Access denied → report plainly. Do not retry silently or attempt elevation.
5. Refresh after a kill and show the **real** outcome.
6. Summary: `3 servers running` / `ok`.
7. Enumeration failure → `unavailable` with the reason.

### Files

| Action | File |
|---|---|
| Create | `src/modules/ports/index.js` |
| Create | `src/modules/ports/scanner.js` — netstat + process resolution |
| Modify | `src/renderer/renderer.js` — ports panel with kill buttons |

### Acceptance criteria

- [x] Lists a server started by hand on port 3000, with its PID
- [x] Command line resolves to something recognisable, or honestly `unknown`
- [x] Kill confirms with PID and command line
- [x] Killing frees the port — verified by re-running the scan
- [x] Access denied is reported plainly
- [x] System PIDs are never offered as killable
- [x] Enumeration < 2 s

### Verify

```bash
npx http-server -p 3000 &   # something real to find
npm start                    # module lists it; kill from the UI; scan again
```

### Commit

```
feat: add Ports module for local dev servers

Running several dev servers at once means "port already in use" with nothing
to say which process holds it. Resolves listening ports to a PID and command
line, falling back to an honest "unknown" for the working directory, which
Windows does not expose. Killing confirms with the PID and command line first,
and the outcome is re-checked rather than assumed.
```

---

## Phase 6 — Packaging

> **Deferred.** Do not start without being asked.

**Goal:** ship an installer so the app runs without Node and registers auto-start
under its own identity.

Unpackaged, auto-start points into `node_modules` and the registry key is
generic (T8). `electron-builder` fixes both, gives the app its own icon and name
in the startup list, and removes the Node prerequisite.

### Acceptance criteria

- [x] Installer produces a working app on a machine without Node
- [x] Auto-start survives a reboot and is listed under the app's own name
- [x] Claude Usage is unaffected

---

## Platform support

**Windows only.** Phases 4 and 5 are inherently Windows-specific (long-path
deletion, `netstat`, `Win32_Process`). Phases 1–3 would additionally break on
macOS at `skipTaskbar` (no-op; needs `app.dock.hide()`), `tray.on('right-click')`
(never fires), and `setLoginItemSettings({path, args})` (Windows-only fields).

**Do not add macOS support speculatively.** Declaring Windows-only is honest;
shipping untested branches is not.
