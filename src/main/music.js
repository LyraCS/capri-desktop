'use strict';

// What's playing on this Mac, for her: Music or Spotify (through AppleScript - only asked when the app
// is already running, or asking would launch it), its artwork (Apple's own search, no key), and the
// playlists she can start. Polled, so she can move to it and answer "what's this song?".

const fs = require('node:fs');
const { execFile } = require('node:child_process');

const MUSIC_ASK = `set acc to ""
if application "Music" is running then
  tell application "Music"
    try
      if player state is not stopped then
        set stateText to "paused"
        if player state is playing then set stateText to "playing"
        set acc to acc & "Music" & linefeed & stateText & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed
      end if
    end try
  end tell
end if
`;

// Spotify's own terms compile only when it's installed: a script that names them on a Mac without it
// won't even parse (and then nothing is ever read).
const SPOTIFY_ASK = fs.existsSync('/Applications/Spotify.app') ? `if application "Spotify" is running then
  tell application "Spotify"
    try
      if player state is not stopped then
        set stateText to "paused"
        if player state is playing then set stateText to "playing"
        set acc to acc & "Spotify" & linefeed & stateText & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed
      end if
    end try
  end tell
end if
` : "";

const ASK = `${MUSIC_ASK}${SPOTIFY_ASK}return acc`;

const PLAYLISTS = `if application "Music" is running then
  tell application "Music"
    set AppleScript's text item delimiters to linefeed
    return (name of every user playlist) as text
  end tell
end if
return ""`;

const PLAY = `on run argv
  tell application "Music"
    play user playlist (item 1 of argv)
  end tell
end run`;

function osascript(script, args = []) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script, ...args], { timeout: 10000 }, (err, out) => resolve(err ? null : String(out)));
  });
}

const EMPTY = { playing: false, app: null, state: null, title: '', artist: '', album: '', art: null };
let current = { ...EMPTY };
let onChange = null;
let timer = null;
let busy = false;
const art = new Map(); // title|artist -> { at, url }

// The store's cover for what's playing, as a data URL (the renderer never touches the network).
async function artwork({ title, artist }) {
  const key = `${title}|${artist}`;
  const hit = art.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.url;
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=1&media=music`, {
      signal: AbortSignal.timeout(6000),
    });
    const body = res.ok ? await res.json() : null;
    const url = body?.results?.[0]?.artworkUrl100?.replace('100x100bb', '300x300bb') || null;
    if (!url) {
      art.set(key, { at: Date.now(), url: null });
      return null;
    }
    const img = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const type = img.headers.get('content-type') || 'image/jpeg';
    const data = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
    art.set(key, { at: Date.now(), url: data });
    return data;
  } catch {
    return null; // no cover: the strip shows the title alone
  }
}

// "App", state, title, artist, album, five lines each; a playing one first, else a paused one.
function parse(out) {
  const lines = String(out || '').split('\n');
  const found = [];
  for (let i = 0; i + 4 < lines.length; i += 5) {
    const [app, state, title, artist, album] = lines.slice(i, i + 5);
    if (app && title) found.push({ app, state, title, artist: artist || '', album: album || '' });
  }
  const hit = found.find((m) => m.state === 'playing') || found[0];
  if (!hit) return { ...EMPTY };
  return { ...hit, playing: hit.state === 'playing', art: null };
}

async function probe() {
  if (busy) return;
  busy = true;
  try {
    const next = parse(await osascript(ASK));
    if (next.title) next.art = await artwork(next);
    const same = next.app === current.app && next.state === current.state
      && next.title === current.title && next.artist === current.artist;
    if (!same) {
      current = next;
      onChange?.(current);
    }
  } finally {
    busy = false;
  }
}

function start(cb) {
  onChange = cb;
  probe();
  timer = setInterval(probe, 3000);
  timer.unref?.();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

const get = () => current;

async function playlists() {
  const out = await osascript(PLAYLISTS);
  return String(out || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

const key = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Starts a playlist of hers by name ("mixtape", "7-80s"): exact first, then the closest one.
async function playPlaylist(wanted) {
  const want = key(wanted);
  if (!want) return null;
  const names = await playlists();
  const hit = names.find((n) => key(n) === want)
    || names.find((n) => key(n).includes(want))
    || names.find((n) => want.includes(key(n)));
  if (!hit) return null;
  const ok = await osascript(PLAY, [hit]);
  return ok === null ? null : hit;
}

module.exports = { start, stop, get, playlists, playPlaylist, probe };
