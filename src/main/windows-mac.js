'use strict';

// Feeds the overlay with the position of the other windows (macOS), so Capri can sit on them.
// A small Swift helper (src/main/mac/windows.swift) asks Quartz for the on-screen windows in
// points, which are already the overlay's coordinates: no conversion needed, unlike Windows.
// It also says where the Dock is (the pill she rests on, `dock`), when the front window is
// another AI (ChatGPT, Gemini…: `ai`, the names it matched), for her jealousy, and never passes
// on a title; which game is in front, if one (`game`, its folder in a launcher's library); and
// the USB sticks plugged in (`usb`).

const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

// `npm run build:mac` puts it in build/; the packaged app carries it in Contents/Resources
function helperPath() {
  if (process.env.CAPRI_WINDOWS_HELPER) return process.env.CAPRI_WINDOWS_HELPER;
  const packaged = path.join(process.resourcesPath || '', 'capri-windows');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', 'build', 'capri-windows');
}

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform !== 'darwin') return { stop() {}, refresh() {} };

  const helper = helperPath();
  if (!fs.existsSync(helper)) {
    console.error('[capri] window watch: helper missing (run `npm run build:mac`):', helper);
    return { stop() {}, refresh() {} };
  }

  let child = null;
  let stopped = false;
  let restarts = 0;
  let gen = 0; // which helper is the live one: an old one's exit is not a crash
  let last = null; // the helper's last snapshot: it only speaks when something changes

  // the snapshot as seen from her window, wherever it is now (the helper gives screen points)
  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => ({ id: w.id, app: w.app, x: w.x - bounds.x, y: w.y - bounds.y, w: w.w, h: w.h, max: Boolean(w.max) }))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    // the Dock, where it is on her screen (null when it's on another one). Its top is often right
    // at the bottom of her window (she rests on it), so a Dock touching that edge still counts.
    const d = last.dock;
    const dock = d && d.x - bounds.x < bounds.width && d.x - bounds.x + d.w > 0
      && d.y - bounds.y <= bounds.height && d.y - bounds.y + d.h > 0
      ? { x: d.x - bounds.x, y: d.y - bounds.y, w: d.w, h: d.h } : null;
    onUpdate({
      fg: last.fg, front: String(last.front || ''), taskbar: Boolean(last.taskbar), ai: Array.isArray(last.ai) ? last.ai : [],
      game: last.game || null, usb: Array.isArray(last.usb) ? last.usb : [], plug: last.plug || null, wins, dock,
    });
  };

  const start = () => {
    const mine = ++gen;
    const proc = spawn(helper, ['--self', String(process.pid), '--pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;

    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      try {
        last = JSON.parse(line);
      } catch {
        return;
      }
      send();
    });
    proc.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    proc.on('error', (err) => console.error('[capri] window watch:', err.message));
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      if (stopped || mine !== gen) return; // replaced on purpose (the screen changed)
      // a crash loop would just burn the battery: three tries, then she sits on the floor
      if (restarts++ < 3) setTimeout(start, 3000);
      else if (code) console.error('[capri] window watch stopped (helper exit', code, ')');
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // her window moved (another screen, the Dock in it or not): the same windows, from there
    refresh: send,
    // the screen's work area changed (the Dock resized or moved, another display): AppKit caches
    // it in a process without a run loop, so the helper starts over and reads it again
    restart() {
      if (stopped) return;
      child?.kill();
      restarts = 0;
      start();
    },
  };
}

module.exports = { startWindowWatch, helperPath };
