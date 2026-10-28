'use strict';

// Closing an app when you ask her to (chat.js), after you've confirmed with a click. The apps with
// a window, by name; closing one the way its own close button does (it can still ask you to save),
// and only if you ask again, forcing it.

const path = require('node:path');
const { execFile } = require('node:child_process');

const MAC = process.platform === 'darwin';

// never these: the desktop itself, Windows' own pieces, her (Capri), Claude (she watches it) and
// Ollama (she talks through it)
const KEEP = new Set([
  'explorer', 'applicationframehost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'searchapp', 'lockapp', 'dwm', 'capri', 'electron', 'claude', 'codex', 'ollama', 'ollama app',
  // macOS' own pieces
  'finder', 'dock', 'systemuiserver', 'windowserver', 'loginwindow', 'controlcenter', 'notificationcenter',
  'spotlight', 'opencode',
]);

function powershell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
    ], { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });
}

// [{ name, process, ids }]: one per program with a window open ("AM Music", "Discord"...)
async function list() {
  if (MAC) return macList();
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | '
    + 'ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; label = $_.Description } } | '
    + 'ConvertTo-Json -Compress',
  );
  const rows = [].concat(out ? JSON.parse(out) : []);
  const apps = new Map();
  for (const { id, name, label } of rows) {
    if (id === process.pid || KEEP.has(name.toLowerCase())) continue;
    const app = apps.get(name) || { name, process: name, label: label || '', ids: [] };
    app.ids.push(id);
    apps.set(name, app);
  }
  return [...apps.values()];
}

// The running apps that have a Dock presence or a window: their process path is inside their bundle.
function macList() {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,comm='], { timeout: 5000 }, (err, out) => {
      if (err) return resolve([]);
      const apps = new Map();
      for (const line of String(out).split('\n')) {
        const m = /^\s*(\d+)\s+(.+?\.app)\/Contents\/MacOS\//.exec(line);
        if (!m) continue;
        // only the apps you launched yourself: not the system's own agents, which live in
        // /System/Library and would just be noise (and impossible to quit politely)
        if (/^\/(System\/Library|usr|bin|sbin|Library|opt)\//.test(m[2])) continue;
        if (m[2].includes('/Contents/Frameworks/')) continue; // an app's own helper processes
        const name = path.basename(m[2], '.app');
        if (KEEP.has(name.toLowerCase())) continue;
        const app = apps.get(name) || { name, process: name, label: '', ids: [] };
        app.ids.push(Number(m[1]));
        apps.set(name, app);
      }
      resolve([...apps.values()]);
    });
  });
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The open app that `wanted` names, by its name or its description ("am music", "YouTube Music").
async function find(wanted) {
  const key = simple(wanted);
  if (key.length < 2) return null;
  const apps = await list();
  const score = (app) => {
    const names = [simple(app.name), simple(app.label)].filter(Boolean);
    if (names.includes(key)) return 3;
    if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
    if (key.length >= 3 && names.some((n) => n.includes(key) || key.includes(n))) return 1;
    return 0;
  };
  const best = apps.map((app) => [score(app), app]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

// Closes it like its close button would; `force` ends it outright (unsaved work is lost).
// Resolves with what's left: { running } (true when it stayed open, or hid in the tray).
async function close(name, { force = false } = {}) {
  const app = (await list()).find((a) => a.process === name);
  if (!app) return { running: false };
  if (MAC) {
    // the same polite quit as its own menu (SIGTERM), or an outright end when asked twice
    for (const id of app.ids) {
      try { process.kill(id, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* gone already */ }
    }
    await new Promise((r) => setTimeout(r, force ? 600 : 2500));
    const left = (await list()).find((a) => a.process === name);
    return { running: Boolean(left) };
  }
  const ids = app.ids.join(',');
  const out = await powershell(force
    ? `Stop-Process -Id ${ids} -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; `
      + `@(Get-Process -Id ${ids} -ErrorAction SilentlyContinue).Count`
    : `foreach ($p in @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue)) { [void]$p.CloseMainWindow() }; `
      + 'Start-Sleep -Milliseconds 2500; '
      + `@(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Count`);
  return { running: Number(out) > 0 };
}

module.exports = { list, find, close, powershell };
