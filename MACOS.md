# Capri on macOS

This is the macOS port of [capri-desktop](https://github.com/mochiiwuff/capri-desktop). Same Electron app,
same sprites, same brain: it runs natively on Apple Silicon (Intel Macs build from source), perches on your
windows, and can watch **OpenCode** as well as Claude Code, Codex and Antigravity.

Tested on an M2 MacBook Air (8 GB) running macOS 27. She is a menu bar app: no Dock icon, `⌘⌃C` tucks her away.

## Install the release

Download the latest `.dmg` (Apple Silicon) from the [latest release](https://github.com/LyraCS/capri-desktop/releases/latest),
open it, and drag **Capri** into **Applications**. macOS 13 or newer.

The build is ad-hoc signed, not notarized, so macOS blocks the first launch: right-click **Capri** in
Applications › **Open** › **Open** (or System Settings › Privacy & Security › **Open Anyway**). In a terminal,
clearing the flag once works too:

```sh
xattr -dr com.apple.quarantine /Applications/Capri.app
```

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
**Possess my windows**.

Her resting places follow the Dock, which is a floating pill on a Mac and not a taskbar that spans the screen:
**When she rests › In her corner** stands her at the right end of the Dock, and **Sitting on the Dock** sits her
on it, legs hanging over it. Either way she moves with it when you change its size in System Settings, add or
remove apps, or move it to another edge. An auto-hidden Dock is no place to sit (it isn't there most of the
time), so she rests on the bottom of the screen instead; with the Dock on the left or right, her corner is the
bottom-right of the work area, beside it.

How it works: `windows-mac.js` spawns `capri-windows`, which asks Quartz for the on-screen windows (positions
in points, the same units the overlay uses) and prints one JSON line per change. No permissions, no injection.
macOS publishes the Dock's edge and height (the work area) but not its bar: the helper works out where the pill
is from the Dock's own size and tiles, a little narrower than it really is so she never floats past its end.
If the helper dies three times in a row, she gives up on perching for that run and stays on the floor.

## Feeling your Mac

Everything she senses about the machine is native, and nothing needs a permission:

- **The processor** — `os.cpus`, sampled every 3 s. Full tilt for a while and she overheats.
- **The charger and the battery** — the browser's battery API, which Chromium reads from IOKit: plugged in,
  unplugged, running low.
- **The network** — the browser's own online/offline events, not an API call of hers: the assistant's endpoint
  being down doesn't blind her, and a blip under four seconds isn't worth a line.
- **USB sticks and SD cards** — `diskutil list external physical`, by the name of the volume (not "disk4"),
  looked at again within a second of one arriving. She dives into it by the clock: on a Mac that's her own icon
  in the menu bar, top right, so the dive and the lightning go to the top edge of her window under it.
- **Anything else you plug in** — a phone, a controller, a headset, a camera: IOKit tells the helper the moment
  a USB device arrives or goes (no polling), with the name the device gives and the kind of thing it is. She
  sends a bolt up to the clock and says what it was. Hubs are left out (they only come with the devices you
  plugged in), and so is the Mac's own hardware.
- **Games** — the program of the window in front is matched against Steam's and Epic's libraries, GOG's
  bundles (its `goggame-*.info` file) and Riot's own `.app`s. She says something and steps aside while you
  play, then comes back to ask if you won.
- **The Wi-Fi** — `scutil --nwi` every 20 s: the link going, coming back, or another address under her (another
  network). macOS hides network names from apps that haven't asked for Location, so she doesn't say its name.
- **The screen going** — `powerMonitor`'s lock/suspend and unlock/resume: she curls up when it locks and
  stretches back when you're there, with a line.

`capri-windows --devices`, `--disk <id>` and `--game <path>` print what the helper makes of them.

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

Her chat works with any OpenAI-compatible endpoint, no Ollama required.

**9Router**, if it's running on this Mac (dashboard at `http://localhost:20128/dashboard`): menu › **AI model ›
9Router (local)**, paste one of its keys, and she picks a model that actually answers (change it in the same menu).
Connect the providers you want in its dashboard first: without one, none of its models can answer.

Anything else that speaks OpenAI:

menu › **AI model › Custom (customUrl in config)**, then **API key or address…** and paste:

- address: `https://opencode.ai/inference/openai/v1` (or your own gateway)
- key: your key

The built-in providers (OpenRouter, OpenAI, Groq, Gemini, DeepSeek, Mistral) only need their key, and the
local options (Ollama, LM Studio, llama.cpp) still work if you'd rather keep it offline. Keys are encrypted
with your login keychain and stored in the app's config folder.

## Her facecam

menu › **Mini-box › Show it** puts her face in a square, always-on-top window you can drag anywhere: her own
face, with her name and a **LIVE** badge, a **TALK** button that opens her chat, and the song playing at the
bottom with its cover. She moves on the beat and stands dead still when the music stops. Her faces are the sheet
in `assets/capri/sprites.png`, cut into 25 portraits by `tools/cut-faces.swift`; she shuffles through them with a
glitch on every change — the ones that fit idling, working, waiting on you, asleep, or a song playing.

Her tiles tear too: the glitch sheet in `assets/capri/glitch.png` is cut into its pieces (`tools/cut-glitch.swift`)
and two to four of them flash over her face every second or so — more, and bigger, when she's waiting on you or a
song is playing. It's all her own art, not a filter.

It isn't a cage: while it's on, she's in the tile when you're anywhere else, and steps out of it (back onto
your desktop, where she perches and does her thing) as soon as the app in front is a **terminal** or an
**editor** — Terminal, iTerm, Warp, kitty, VS Code, Cursor, Zed, Xcode and the like. **Small / Medium / Large**
sets its size, and it remembers where you left it.

## Music

Ask her to play something and she plays it in **Apple Music**: Apple's own search (no key) finds the song, the
Music app opens on its album and she starts it, skipping to the track. Music only starts an album's queue from
its first track, and only when it was stopped, so she stops what was playing, plays the album and skips — about
three seconds. If the song isn't found, or the album doesn't load, she leaves its page open and says so.

menu › **Music plays in** switches that to **Spotify** (a search in the app) or **YouTube** (the right video, in
your browser). Saying "on Apple Music", "on Spotify" or "on YouTube" in your message overrides it for that song.

## What differs from the Windows build

- Menu bar instead of the notification area; `⌘⌃C` instead of `Ctrl+Alt+C`; "the Dock" instead of "the taskbar".
- Window tracking is Quartz instead of Win32; the AI-in-front detection has no window titles without Screen
  Recording, so it falls back to app names. What you plug in comes from IOKit and DiskArbitration instead of
  WMI, and games are found in the launchers' libraries on this Mac (Steam, Epic, GOG, Riot).
- Apps are found in `/Applications`, `~/Applications`, `/System/Applications` and Steam's macOS library.
  Close an app with a polite `SIGTERM` (the same as its own Quit), and with `SIGKILL` only when you ask twice.
- File search uses Spotlight (`mdfind`) instead of Windows Search; screenshots use `desktopCapturer`.
- Ollama is not installed for you (no winget): when it's missing she opens ollama.com/download, and can start it
  and run Claude Code or Codex through it in a Terminal window.
- Everything else is the same app: same animations, same lines, same bond, same mission log.
