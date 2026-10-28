#!/usr/bin/env node
'use strict';

// Builds the small Swift helper that tells Capri where the other windows are (src/main/mac/windows.swift).
// On macOS only; on Windows it does nothing, so `npm start` stays one command everywhere.
// Needs the Command Line Tools (`xcode-select --install`), not Xcode.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'main', 'mac', 'windows.swift');
const OUT = path.join(ROOT, 'build', 'capri-windows');

if (process.platform !== 'darwin') process.exit(0);

const fresh = fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs >= fs.statSync(SOURCE).mtimeMs;
if (fresh && !process.argv.includes('--force')) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
// the same Macs as the app (Electron 44 wants macOS 13): without a target, swiftc asks for the
// build machine's own version and the helper won't start on anything older
const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
try {
  execFileSync('swiftc', ['-O', '-target', target, '-o', OUT, SOURCE], { stdio: 'inherit' });
  console.log('[capri] window helper built:', path.relative(ROOT, OUT));
} catch (err) {
  console.error('[capri] could not build the window helper (no Command Line Tools?):', err.message);
  console.error('[capri] she runs without perching: install them with `xcode-select --install`.');
  process.exit(0); // never block the app on it: perching is a bonus, not the point
}
