'use strict';

// The macOS window/device helper (src/main/mac/windows.swift), as far as it can be looked at
// without a Mac to plug things into: the games it recognises, and the shape of a snapshot.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const helper = path.join(__dirname, '..', 'build', 'capri-windows');
const built = process.platform === 'darwin' && fs.existsSync(helper);
const run = (...args) => execFileSync(helper, args, { encoding: 'utf8', timeout: 20000 }).trim();

test('helper: the games it knows', { skip: built ? false : 'no helper on this machine' }, () => {
  const game = (file) => run('--game', file);
  // Steam and Epic: the folder in the launcher's library
  assert.equal(game('/x/steamapps/common/Hades/Hades.app/Contents/MacOS/Hades'), 'Hades');
  assert.equal(game('/Users/Shared/Epic Games/Fortnite/Fortnite.app/Contents/MacOS/Fortnite'), 'Fortnite');
  // Riot: its own .app
  assert.equal(game('/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClient'), 'League of Legends');
  // not games
  assert.equal(game('/Applications/Safari.app/Contents/MacOS/Safari'), '-');
  assert.equal(game('/Applications/Steam.app/Contents/MacOS/steam_osx'), '-');
  assert.equal(game('/x/steamapps/common/Steamworks Common Redistributables/install.vdf'), '-');
  assert.equal(game('/Applications/GOG Galaxy.app/Contents/MacOS/GOG Galaxy'), '-');
});

test('helper: a snapshot has what windows-mac.js reads', { skip: built ? false : 'no helper on this machine' }, () => {
  const snap = JSON.parse(run('--dump'));
  for (const key of ['fg', 'taskbar', 'ai', 'game', 'usb', 'plug', 'dock', 'wins']) {
    assert.ok(key in snap, `missing ${key}`);
  }
  assert.equal(snap.taskbar, false); // no taskbar on a Mac
  assert.ok(Array.isArray(snap.ai));
  assert.ok(Array.isArray(snap.usb));
  assert.ok(Array.isArray(snap.wins));
  assert.ok(snap.plug === null || typeof snap.plug === 'object');
});
