#!/usr/bin/env node
'use strict';

// Puts Capri's OpenCode plugin where OpenCode looks for it, and takes it out again.
// OpenCode V2 loads every direct .ts/.js file under ~/.config/opencode/plugins/ (or
// $XDG_CONFIG_HOME/opencode/plugins/) without any config change: one file, no settings to merge.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARK = 'capri-opencode.ts';
const SOURCE = path.join(__dirname, '..', 'hooks', 'opencode', MARK);

function configDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(os.homedir(), '.config'), 'opencode');
}

function pluginPath() {
  return path.join(configDir(), 'plugins', MARK);
}

// An installed copy could be out of date after an update: say so, so the tray can offer it again.
function status() {
  const file = pluginPath();
  try {
    if (!fs.existsSync(file)) return { file, installed: false, stale: false };
    const here = fs.readFileSync(file, 'utf8');
    const there = fs.readFileSync(SOURCE, 'utf8');
    return { file, installed: true, stale: here !== there };
  } catch (err) {
    return { file, installed: false, stale: false, error: err.message };
  }
}

function configure(uninstall = false) {
  const file = pluginPath();
  if (uninstall) {
    // only ever our own file, never anything else in their plugins folder
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Capri')) fs.rmSync(file);
    return { file };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(SOURCE, file);
  return { file };
}

module.exports = { configure, status, install: () => configure(), uninstall: () => configure(true) };
if (require.main === module) {
  try {
    const uninstall = process.argv.includes('--uninstall');
    const { file } = configure(uninstall);
    console.log(`Capri OpenCode plugin ${uninstall ? 'removed from' : 'installed at'} ${file}`);
    if (!uninstall) console.log('Restart OpenCode (or reload it) and start a conversation.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
