# Capri on macOS

This is the macOS port of [capri-desktop](https://github.com/mochiiwuff/capri-desktop). Same Electron app,
same sprites, same brain: it runs natively on Apple Silicon (and Intel), perches on your windows, and can
watch **OpenCode** as well as Claude Code, Codex and Antigravity.

Tested on an M2 MacBook Air (8 GB) running macOS 27. She is a menu bar app: no Dock icon, `⌘⌃C` tucks her away.

## Run it from the source

```sh
git clone https://github.com/LyraCS/capri-desktop
cd capri-desktop
npm install --cache ./.npm-cache
npm start
```

`npm install` needs Node 20 or later. The `--cache` flag is only there because a root-owned npm cache
(`~/.npm/_cacache`) is a common macOS annoyance; drop it if yours is fine.

Perching needs a tiny Swift helper (`src/main/mac/windows.swift`, compiled by `npm start` with `swiftc`).
That comes with the **Command Line Tools** — Xcode is not needed:

```sh
xcode-select --install
```

Without them she still runs, she just can't sit on windows. `npm run build:mac` rebuilds the helper on
demand; `build/capri-windows` is the result.

## Build the app

```sh
npm run dist:mac
```

The `.dmg` and `.zip` land in `dist/`. The build is ad-hoc signed (no Apple Developer account needed), which
is enough for your own Mac. macOS ties its privacy permissions (Screen Recording, Automation) to the app's
signature: rebuilding the app may ask you for them again.

## Permissions

Nothing is required for her to work. Two optional things ask macOS for permission the first time:

- **Screen Recording** — for "Look at my screen" and for reading window *titles* (window positions and app
  names do not need it). Without it she simply has less to say about what's in front.
- **Automation** — when she drives Terminal (Ollama setup) or controls Spotify/Music for the media replies.

Everything lives in `~/Library/Application Support/capri-desktop` (config, memory, custom sounds).

## Perching (sitting on your windows)

On by default. She sits on the top edge of the window in front while the assistant works, and rides along when
it moves, closes or goes fullscreen (then she drops to her corner). Turn it off in her menu with
**Possess my windows**, and pick **When she rests › Sitting on the Dock** if you want her to hang off the Dock
instead of her corner.

How it works: `windows-mac.js` spawns `capri-windows`, which asks Quartz for the on-screen windows (positions
in points, the same units the overlay uses) and prints one JSON line per change. No permissions, no injection.
If the helper dies three times in a row, she gives up on perching for that run and stays on the floor.

## Watching OpenCode

```sh
npm run hooks:opencode:install
```

or her menu › **OpenCode hooks: installed**. This copies one file,
`~/.config/opencode/plugins/capri-opencode.ts`, into OpenCode's plugin folder; OpenCode V2 loads it by itself
on the next start. Then restart OpenCode (or reload it) and pick **Watch › OpenCode** in her menu.

The plugin is observe-only: it translates OpenCode's session and tool events into the hook events Capri already
understands (prompts, tool calls, permission prompts, turn ends, interrupts) and POSTs them to
`127.0.0.1:47823`. It never blocks a turn, never decides a permission, and sends nothing anywhere else.
`npm run hooks:opencode:uninstall` removes it.

## Chat

Her chat works with any OpenAI-compatible endpoint, no Ollama required:

menu › **AI model › Custom (customUrl in config)**, then **API key or address…** and paste:

- address: `https://opencode.ai/inference/openai/v1` (or your own gateway)
- key: your key

The built-in providers (OpenRouter, OpenAI, Groq, Gemini, DeepSeek, Mistral) only need their key, and the
local options (Ollama, LM Studio, llama.cpp) still work if you'd rather keep it offline. Keys are encrypted
with your login keychain and stored in the app's config folder.

## What differs from the Windows build

- Menu bar instead of the notification area; `⌘⌃C` instead of `Ctrl+Alt+C`; "the Dock" instead of "the taskbar".
- Window tracking is Quartz instead of Win32; the AI-in-front detection has no window titles without Screen
  Recording, so it falls back to app names.
- Apps are found in `/Applications`, `~/Applications`, `/System/Applications` and Steam's macOS library.
  Close an app with a polite `SIGTERM` (the same as its own Quit), and with `SIGKILL` only when you ask twice.
- File search uses Spotlight (`mdfind`) instead of Windows Search; screenshots use `desktopCapturer`.
- Ollama is not installed for you (no winget): when it's missing she opens ollama.com/download, and can start it
  and run Claude Code or Codex through it in a Terminal window.
- Everything else is the same app: same animations, same lines, same bond, same mission log.
