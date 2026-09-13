# Dev Dashboard — working notes for Claude

You are continuing work that started in a previous conversation. This file is
that conversation's memory. Read it, then read `PHASES.md`, before doing
anything.

## What this is

A new, standalone Windows desktop widget: one small always-on-top window with
four local developer tools — Repos, Cost / Project, Disk, Ports. Electron, plain
JavaScript, no framework, offline, never touches credentials.

**`PHASES.md` is the authoritative plan.** It specifies every phase, its data
sources, requirements, acceptance criteria and commit message. Do not improvise
past it; if it is wrong, fix it and say so.

## The sibling project — hands off

`D:\Claude Usage` (`github.com/SoSereysokbotra/claude-usage-widget`) is a
finished Claude-usage widget built in the previous conversation. It runs on the
developer's machine all day.

- **Never modify it.** Not a file, not a commit, not a restart.
- **Copy from it, never import.** `PHASES.md` Phase 1 lists exactly which files
  to copy and why. Each one fixed a real failure that this project will hit
  identically.
- It owns `Ctrl+Alt+C`. This project uses `Ctrl+Alt+D`.

## About the developer

- Year 2 software engineering student. Builds real projects (Angular, Node,
  Firebase, microservices, robotics, deep learning).
- English is not their first language. **Explain in plain, short sentences.**
  They asked several times for simpler explanations after I used jargon. When
  something is technical, show it — a small diagram, a mock of the screen, a
  table — rather than describing it in prose.
- They think ahead about UX (they spotted that five widgets would clutter the
  screen before it was built). Take their design questions seriously.
- They care that data is **real, not mocked**. They asked this directly. Every
  number the app shows must be traceable to a file or command, and you should
  be ready to prove it.
- They want to **learn**, not just receive code. When a phase is done, explain
  what was hard and why the solution is shaped the way it is.

## No assumptions when implementing

This is the most important rule in this file. **Before writing code that
depends on something being true, check that it is true.** Check first, then
code. Never the other way round.

Every serious bug in the sibling project came from an assumption that felt
safe:

| Assumed | Actually | Cost |
|---|---|---|
| `nativeImage` can load the logo | It cannot decode WebP; returns empty silently | Blank tray icon |
| `npm install` succeeded, so the app runs | Electron binary was never downloaded | Every clone broken |
| The cached usage file is current | 126 minutes stale; read 100% for a reset window | Wrong number on screen |
| Inline `style="width:40%"` works | CSP blocked it silently | Empty meters |
| The API response always has `five_hour` | It is `null` on some plans | Would drop users to fallback forever |
| A screenshot shows the window | GDI capture misses transparent windows | Debugged a "blank" app that was fine |
| Register a shortcut and it's yours | Returns `false` if another app owns it | Silent no-op |

None of those were unreasonable guesses. All of them were wrong.

**What this means in practice:**

- **A file path** — `fs.existsSync` it, and read one real record, before parsing.
- **A field in a file** — print an actual record and look at it. Do not code
  against a shape from memory or from documentation.
- **A command on PATH** (`git`, `netstat`) — run `--version` first; handle absence.
- **A library capability** — try it in a five-line script and look at the result.
  Do not trust that a method exists or that it accepts that input.
- **An OS behaviour** (registry key, long paths, port ownership, DPI) — test it
  on this machine, then code to what you observed.
- **A number** (file count, scan time, size) — measure it. `PHASES.md` has
  measured values; if yours differ, find out why before continuing.
- **A performance claim** — time it. "Should be fast" is not a measurement.
- **What the developer meant** — if a requirement can be read two ways and the
  readings lead to different code, ask. One question costs a minute; the wrong
  reading costs a phase.
- **What `PHASES.md` leaves out** — if a phase is silent on something you need
  to decide, do not fill the gap quietly. Say what is missing, propose an
  answer, and get it confirmed.

The test for whether you are assuming: **can you paste the output that proves
it?** If not, you have not checked.

## How to work

**One phase per session.** Do not combine phases. Tick the boxes in `PHASES.md`
when done and commit that with the work.

**Verify, do not assume.** See the section above — it is the rule everything
else depends on. This project's predecessor was built by measuring everything:
scan times, duplicate counts, registry values, stale-cache ages. Keep that
standard. Paste real command output, not descriptions of it.

**Never invent data.** If a value is unavailable, the UI says so and why. No
zeros standing in for unknowns.

**Test on the real machine data.** There are 81 git repos, 82 `node_modules`
folders and 96 Claude project paths on `D:\`. Use them. Fixtures only for
failure paths that cannot be produced naturally.

**Restart and screenshot after UI changes.** The widget window is transparent
and DWM-composited, so ordinary screen capture misses it. Use this recipe
(PowerShell): make the process DPI-aware with
`SetProcessDpiAwarenessContext((IntPtr)-4)`, find the window by title via
`EnumWindows` on the electron PIDs, `GetWindowRect`, then `PrintWindow(hwnd,
hdc, 2)` into a bitmap of that size. Save as PNG and Read it. Without the DPI
call the bitmap is undersized and the capture is clipped.

**When something fails, find the cause before working around it.** In the
previous project, "the window opened but showed nothing" turned out to be the
capture method, not the app; "npm install succeeded but nothing runs" turned
out to be a missing lockfile flag, not a broken install. Both would have been
papered over by a retry.

## Environment gotchas

- The developer's shell is **PowerShell**, not bash. When giving them commands
  to run, give single-line PowerShell — `\` line continuation is a bash-ism
  and broke a paste once. Your own Bash tool is Git Bash and works normally.
- **VS Code exports `ELECTRON_RUN_AS_NODE=1`.** Running `electron .` from any
  VS Code terminal makes the app die at startup. Always `npm start`, which
  runs the launcher that strips it. This bit us on the very first launch.
- Display scaling is 1.25. Window coordinates from Electron are DIPs; from
  Win32 they are physical unless the process is DPI-aware.
- No Rust installed. Do not propose Tauri.

## Git conventions

- **Separate commits per feature**, in dependency order, each with a subject
  and a body explaining *why* — the non-obvious reason, not a restatement of
  the diff. `PHASES.md` has the message for each phase.
- **No `Co-Authored-By` trailer.** The developer asked for it to be removed.
- Give commit commands as PowerShell one-liners with multiple `-m` flags.
- Don't `git init`, commit or push unless asked. Offer, then wait.
- Git user is `sobotra`; the GitHub account is `SoSereysokbotra`.

## Start here

The folder contains only `PHASES.md` and this file. Nothing else exists yet —
no `package.json`, no code, no git repo. That is deliberate; the developer
wanted the plan first and the structure later.

The first job is **Phase 1 — Scaffold the shell.** Before writing anything:

1. Read `PHASES.md` end to end.
2. Read the sibling's `src/main.js`, `scripts/launch.js`, `scripts/postinstall.js`
   and `scripts/make-tray-icon.js` — you will be copying them, and the comments
   explain problems you will otherwise rediscover.
3. Confirm with the developer which project name to use (`dev-dashboard` is the
   working name; the folder can be renamed) and whether to `git init` now.

Then build Phase 1, verify every acceptance box with real output, and stop.
