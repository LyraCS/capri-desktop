# AGENTS.md — working in capri-desktop

Capri is an Electron desktop pet: a transparent, always-on-top, click-through overlay with a WebGL
sprite of Capri narrating what a coding agent is doing (Claude Code, Codex, Antigravity, OpenCode).
This repo is LyraCS's fork of `mochiiwuff/capri-desktop`, ported to macOS.
`origin` is LyraCS, `upstream` is mochiiwuff; **work on `macos-lyra`** (the default branch) — `macos-opencode` and `main` are the older
lines and are not where new work goes.

Read this before touching anything. It is the map, not the manual.

## Layout

Two processes with a hard line between them:

- **Main** (`src/main/*.js`, CommonJS, Node/Electron APIs, privileged)
- **Renderer** (`src/renderer/js/*.js`, native ES modules, sandboxed, no network access)
- **`src/preload.js`** is the whole contract between them: `window.host`, ~70 named calls.
  If the renderer needs something new, it goes through `host` — never around it.

### Spine

| File | Lines | Job |
|---|---|---|
| `src/main/main.js` | 1432 | overlay + facecam windows, tray menu (5 languages), every `ipcMain` handler, display logic, powerMonitor, `--dev` debug routes |
| `src/main/bridge.js` | 89 | HTTP on `127.0.0.1:47823`: `/event` (agent hooks POST here), `/health`, `/debug/*` in dev. Refuses any request carrying an `Origin` header |
| `src/main/config.js` | 71 | `config.json` in userData; flat defaults object, no schema |
| `src/main/assistants.js` | 35 | the four agents she can watch, and resolution order |
| `src/renderer/js/app.js` | 876 | composition root: builds everything, wires every callback, handles `capri:command` |
| `src/renderer/js/brain.js` | 522 | hook event → speech and pose: sessions, thinking timer, victory, report card |
| `src/renderer/js/capri.js` | 2540 | her body: stances (`stand/sit/peek/fall/held/fly/down`), modes (`idle/work/alert/sleep`), throw physics, perching, pointing |
| `src/renderer/js/lines.js` | 1943 | every sentence she says: 5 languages, rewritten per assistant and per platform |
| `src/renderer/js/fx.js` | 2167 | canvas layer: intro, teleport, cut-ins, shatter, satellite |

`acting.js` holds the animation sheets (frame keys per act, `SHEET_FPS` 12/24); `sprite.js` is the
WebGL shader that draws her from one cut-out image; `panel.js` is her speech panel; `chat.js` is
talking to her; `voice.js` synthesises every sound with WebAudio (no audio files).

### Her tools (semi-agentic)

`chat.js` holds `TOOLS`: the actions she can take on your machine (music, apps, sites, files, web,
close, remember, name), written as OpenAI-style function specs. The model decides which one and when;
`runTool()` runs it by calling `doNow()` — the same code the old plain-language guess used, so her
lines, buttons and animations are unchanged — and the chat loop feeds the result back for another
turn (four at most). `runTool()` also gets your message: a site *you* named opens right away, one only
the model thought of still gets its address button (`offerSite`).

`llm.js` requests `tools` and reassembles streamed `tool_calls` (OpenAI fragments them across deltas);
`ollama.js` does the same for its own API, and turns `tool_call_id` into the `tool_name` Ollama wants.
`chat:status` only turns tools on when the provider takes them and, on Ollama, when `/api/show` lists
the model's `tools` capability. A provider that answers 400 to a tools request is asked again without
them (`noTools`), and a model without the capability falls back to the old `asked()`/`[[tag]]` path,
which stays for Claude Code too (it runs its own tools).

Two requests in one message are where small models fail: "open Safari and go to YouTube" opened
Safari and never went anywhere. So `open_site` takes an optional `app`, and `launch.js` opens it with
`open -a Safari <url>` (macOS; a name that resolves to nothing falls back to the browser; the IPC is
`apps:site` / `openSite(address, app)`). `open_app`'s tool result tells the model to call `open_site`
next, and `send()` does not trust it to: when a tool opened an app, your message names a known site
(`namedSite`), and no site was opened or offered, it opens that site in the app it just launched
(`openedApp` / `siteRan`).

`tests/chat-tools.test.js` drives that loop with a fake host (music, the compound open, the button,
the weak-model net, the no-tools path); `tests/llm-tools.test.js` covers both provider shapes and the
400 retry.

## Extending: a new coding agent is an adapter, not a core change

She watches agents through adapters. `hooks/opencode/capri-opencode.ts` is the reference
implementation — read it end-to-end before writing another.

The contract:

1. The adapter observes only. It never blocks a turn, never decides anything for the agent, and a
   failed POST is not an error.
2. It translates native events into **Claude Code's hook event names** (`SessionStart`,
   `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`,
   `StopFailure`, `Interrupt`, `SubagentStart`, `SubagentStop`, `PreCompact`, `SessionEnd`), maps
   tool names to Claude's (`bash`→`Bash`, `patch`→`MultiEdit`, …), and converts camelCase inputs to
   snake_case (`filePath`→`file_path`).
3. It POSTs to `http://127.0.0.1:${CAPRI_PORT||47823}/event` with `session_id` prefixed
   `"<assistant>:<id>"`. That prefix is how `brain.js` tells whose session it is — and a *foreign*
   prefix is what triggers her jealousy (`bond.js`, `OWN`).

Wiring a new one: adapter file → installer in `scripts/install-<agent>-hooks.js` (with
`status/install/uninstall`) → entry in `src/main/assistants.js`. Nothing in `main.js` or `brain.js`
needs to know it exists. Then add its name to `ASSISTANT_NAMES` / `OTHERS` in
`src/renderer/js/lines.js` so her speech and her onboarding use its name.

Hermes Agent is the exception that proves the rule: it has no plugin API to live in, but its
`hooks.outbound` webhooks already POST Claude Code's shape (`{hook_event_name, tool_name,
tool_input, session_id, cwd, extra}`) on a background worker, at no cost to the agent's hot path.
So its "adapter" is `scripts/install-hermes-hooks.js` (one config entry, written with
`hermes config set`) plus `src/main/hermes.js`, a translation table applied in `main.js` before the
event reaches the renderer. `brain.js` still only ever sees Claude's vocabulary.

## Conventions a diff must match

- **No bundler, no TypeScript, no linter, no test framework.** `node --test` only. Don't add one.
- **CommonJS in main, ES modules in the renderer.** Values stay in the form the platform gives them.
- **5 languages, by design** (fr, en, es, pt, ru). Every user-facing string lives in
  `src/main/labels.js` (tray) or `src/renderer/js/lines.js` (her speech). Never hardcode UI text —
  two tests assert no Claude-specific text leaks into another assistant's lines.
- **Platform splits are real**: `windows.js` vs `windows-mac.js` (Swift helper
  `src/main/mac/windows.swift`, built by `npm start`), and `macText()` / `MAC_WORDS` rewrite Windows
  vocabulary on a Mac.
- **Comments explain why**, in full sentences, usually naming the failure they prevent
  ("macOS publishes the Dock's edge but not its bar"). Match that voice or your diff reads foreign.
- **Timing constants live at the top of the file** as named `const`s with a comment
  (`THINK_AFTER`, `SLEEP_AFTER`, `NOTICE_AFTER`). Tune there, not inline.

## Commands

```sh
npm start              # build the Swift helper, then run
npm run dev            # adds /debug/* routes on the bridge and window.dev in the renderer
npm run test:hooks     # node --test tests/hooks.test.js
npm run test:opencode  # node --test tests/opencode.test.js
npm run test:llm       # node --test tests/llm-tools.test.js tests/chat-tools.test.js
npm run test:mac       # builds the helper, then tests/mac-helper.test.js
npm run build:mac      # rebuild the Swift helper only
npm run dist:mac       # dmg + zip into dist/
```

`--dev` debugging is the fast path for visual work: `POST /debug/command` (`act`, `pose`,
`intro`, `teleport`, `stow`, `satellite`…), `/debug/eval` for JS inside the overlay, `/debug/drag`
and `/debug/type` for input, `/debug/capture` for a PNG of her window.

```sh
curl -s localhost:47823/debug/command -d '{"name":"act","act":"celebrate"}'
curl -s localhost:47823/debug/capture -d '{"name":"frame"}'
```

## Test baseline

`test:hooks` + `test:opencode` + `test:llm`: 19 tests, **17 pass, 2 fail on a machine where the OpenCode plugin is
installed** (`~/.config/opencode/plugins/capri-opencode.ts`). Those two assert that
`resolveAssistant()` picks `codex`, but the installed plugin makes it pick `opencode`. Environmental,
pre-existing. Do not "fix" it by editing the assertion until you have decided which side — the
resolver's order or the test's expectation — is the design.

## State on disk

`~/Library/Application Support/capri-desktop/`:

- `config.json` — every setting, plus `apiKeys` (sealed with `safeStorage`), `bond`, `reminders`,
  mission progress (`capri.mission`, `capri.uplinkDay`, `capri.rivals` live in localStorage).
- `memory.json` — chat history and Claude Code's session id.
- `sounds/` — the user's own sound overrides (`capri://usersounds/…`).
- `faces/` — the pictures she wears in the mini-box: `faces:list` hands them to the renderer as
  `file://` urls (the box is a `file://` page, so `capri://` is refused there). Empty, she wears the
  eight faces in `assets/capri/face-*.png`. Nothing in there is ever packaged with the app.

Serve files to the renderer through the `capri://` protocol (`serveProtocol()` in `main.js`);
`capri://app/...` is the repo, `capri://usersounds/...` is the user's folder.

## Before shipping

Run a ponytail review on the change. Releases are versioned in `package.json` and announced with
release notes; the macOS build is ad-hoc signed, so rebuilding asks for Screen Recording and
Automation permission again.

## Known gaps

- Her tools run only when you talk to her. Acting unprompted (starting something on her own) is not
  wired: it would sit next to `pc.js`/`look.js`, gated on the same idle-and-free moments they check.
- Boot sequence, IPC surface and event pipeline are documented above; the physics in `capri.js`
  (throw, leap, fall, possess, pointing) and the drawing internals of `fx.js` are not — treat those
  files as read-on-demand, and verify changes to them live with `npm run dev`.
