#!/usr/bin/env node
'use strict';

// Capri's Hermes Agent adapter: one `hooks.outbound` entry in Hermes' own config, which posts every
// lifecycle event to her bridge on 127.0.0.1. No plugin and no file inside Hermes' source — outbound
// webhooks are the one place Hermes calls out to a URL by itself, and they run on a background worker,
// so watching costs the agent nothing per tool call (a shell hook would spawn a process each time).
//
// Hermes decides its home from HERMES_HOME only, so this resolves it the way a person would: the
// variable when it is set, the single profile when there is exactly one, else the default home.
// shortcut: one profile only, add a profile picker the day a second one exists.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const URL = 'http://127.0.0.1:47823/event';
const NAME = 'capri';
const EVENTS = ['on_session_start', 'pre_llm_call', 'pre_tool_call', 'post_tool_call', 'post_llm_call', 'post_api_request', 'on_session_end', 'subagent_stop'];

function home() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  const root = path.join(os.homedir(), '.hermes');
  try {
    const profiles = fs.readdirSync(path.join(root, 'profiles'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (profiles.length === 1) return path.join(root, 'profiles', profiles[0].name);
  } catch {}
  return root;
}

const configFile = () => path.join(home(), 'config.yaml');

function hermes(args) {
  // launched from the Finder her PATH is tiny: use hermes where it installs itself, else its name
  const bin = process.env.CAPRI_HERMES_BIN || path.join(os.homedir(), '.hermes', 'hermes-agent', '.hermes', 'bin', 'hermes');
  const cmd = fs.existsSync(bin) ? bin : 'hermes';
  return execFileSync(cmd, args, {
    env: { ...process.env, HERMES_HOME: home() },
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function status() {
  const file = configFile();
  try {
    return { file, installed: fs.readFileSync(file, 'utf8').includes(URL), stale: false };
  } catch (err) {
    return { file, installed: false, stale: false, error: err.message };
  }
}

function configure(uninstall = false) {
  const file = configFile();
  try {
    const text = fs.readFileSync(file, 'utf8');
    const others = /^ {2}outbound:/m.test(text) && !status().installed;
    // someone else's outbound webhooks are not ours to replace, and not ours to remove
    if (others) return { ok: false, file, error: 'hooks.outbound already holds other entries; add Capri by hand' };
    if (uninstall) {
      hermes(['config', 'unset', 'hooks.outbound']);
      return { ok: true, file };
    }
    hermes(['config', 'set', 'hooks.outbound', JSON.stringify([{ name: NAME, url: URL, events: EVENTS }])]);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, file, error: String(err.stderr || err.message).trim() };
  }
}

// `node scripts/install-hermes-hooks.js [--uninstall]`: what the tray's one click runs
if (require.main === module) {
  const out = configure(process.argv.includes('--uninstall'));
  console.log(out.ok ? `${process.argv.includes('--uninstall') ? 'removed from' : 'installed in'} ${out.file}` : `failed: ${out.error}`);
  process.exit(out.ok ? 0 : 1);
}

module.exports = { status, install: () => configure(false), uninstall: () => configure(true), home, URL, EVENTS };
