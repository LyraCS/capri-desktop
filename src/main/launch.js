'use strict';

// Opening things when you ask her to (chat.js): an app from the Start menu (Store apps like Spotify
// included) or from /Applications on a Mac, a Steam or Epic game, your music (the media keys:
// pause, next…, so it works with Spotify and most players), a Spotify search, or a website.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { app, shell } = require('electron');
const { powershell } = require('./apps');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
// not things to open from a chat: uninstallers, help pages and the like
const SKIP = /uninstall|désinstaller|desinstalar|deinstall|readme|documentation|release notes|support center|website|manual/i;
const STEAM_SKIP = /redistributable|dedicated server|steamworks/i;
// words that don't tell apps apart ("Roblox Player" is "roblox", "AM Music" is "am")
const FILLER = new Set(['player', 'launcher', 'app', 'the', 'for', 'windows', 'desktop', 'client', 'x64', 'x86', 'beta', 'music', 'musique', 'media', 'audio', 'video', 'videos']);
const CACHE_MS = 10 * 60 * 1000; // installed apps hardly change

let cache = null; // { at, items }

const plain = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const words = (text) => plain(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

// Everything she can open: [{ name, kind: 'app' | 'steam' | 'epic', id }]
async function launchables() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!WIN && !MAC) return [];
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = words(item.name).join(' ');
    if (!key || seen.has(key) || SKIP.test(item.name)) return;
    seen.add(key);
    items.push(item);
  };
  if (MAC) {
    // games first: a game's own entry wins over a shortcut to it
    for (const game of [...(await steamMacGames()), ...epicGames()]) add(game);
    for (const item of macApps()) add(item);
    cache = { at: Date.now(), items };
    return items;
  }
  // games first: a game's own entry wins over a shortcut to it
  for (const game of [...steamGames(await steamRoot()), ...epicGames()]) add(game);
  // the Start menu's list is slow the first time (PowerShell starting cold): main.js asks for it early
  const out = await powershell('Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress', 45000).catch(() => null);
  for (const { Name, AppID } of [].concat(out ? JSON.parse(out) : [])) {
    if (Name && AppID && !/^https?:/i.test(AppID)) add({ name: Name, kind: 'app', id: AppID });
  }
  if (out !== null) cache = { at: Date.now(), items }; // a list that failed isn't kept: next time, again
  return items;
}

// The apps in /Applications (and the user's own), by the name of their bundle ("Safari", "Steam").
function macApps() {
  const roots = ['/Applications', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
  const apps = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.name.endsWith('.app')) continue;
      apps.push({ name: e.name.slice(0, -4), kind: 'app', id: path.join(root, e.name) });
    }
  }
  return apps;
}

// Steam on a Mac keeps its games in ~/Library/Application Support/Steam, and its libraries elsewhere.
async function steamMacGames() {
  const root = path.join(os.homedir(), 'Library', 'Application Support', 'Steam');
  return steamGames(root);
}

function steamRoot() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const found = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(String(out))?.[1].trim();
      resolve(found ? path.normalize(found) : null);
    });
  });
}

// Steam's games, from the manifests in each of its libraries
function steamGames(root) {
  if (!root) return [];
  const libraries = new Set([root]);
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(MAC ? m[1] : m[1].replace(/\\\\/g, '\\')));
  } catch {
    // one library, the main one
  }
  const games = [];
  for (const library of libraries) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(library, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const acf = fs.readFileSync(path.join(library, 'steamapps', file), 'utf8');
        const id = /"appid"\s+"(\d+)"/.exec(acf)?.[1];
        const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
        if (id && name && !STEAM_SKIP.test(name)) games.push({ name, kind: 'steam', id });
      } catch {
        // a manifest being written: skip it
      }
    }
  }
  return games;
}

// Epic's games, from its launcher's manifests (not the Unreal Engine plugins it also keeps there)
function epicGames() {
  const dir = MAC
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
    : path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch {
    return [];
  }
  const games = [];
  for (const file of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (m.bIsIncompleteInstall || m.CatalogNamespace === 'ue' || !m.DisplayName || !m.AppName) continue;
      games.push({ name: m.DisplayName, kind: 'epic', id: `${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}` });
    } catch {
      // not one of its manifests
    }
  }
  return games;
}

// The one of `items` named in `text` (your message, or the name in her tag): all the words of its
// name in it, else at least half of them; the closest wins. null if nothing fits well enough.
function match(items, text) {
  const said = new Set(words(text));
  const joined = words(text).join('');
  let best = null;
  for (const item of items) {
    const all = words(item.name);
    const key = all.filter((w) => !FILLER.has(w));
    if (!key.length) key.push(...all); // a name made only of those ("Media Player"): all of it
    if (!key.length) continue;
    const hits = key.filter((w) => said.has(w) || (w.length >= 5 && joined.includes(w)));
    // a word of 3 letters or more, or all of a short name ("am" for AM Music)
    if (!(hits.some((w) => w.length >= 3) || hits.length === key.length) || hits.length / key.length < 0.5) continue;
    const rank = (hits.length / key.length) * 10 + hits.join('').length / 10;
    if (!best || rank > best.rank) best = { item, rank };
  }
  return best?.item || null;
}

// What's on your desktop (yours and the shared one): files, folders and shortcuts, by name.
function desktopItems() {
  const dirs = MAC ? [app.getPath('desktop')] : [app.getPath('desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  const items = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || /^desktop\.ini$/i.test(e.name)) continue;
      if (MAC && e.name === '.localized') continue;
      const folder = e.isDirectory();
      items.push({ name: folder ? e.name : e.name.replace(/\.[^.]+$/, ''), kind: folder ? 'folder' : 'file', id: path.join(dir, e.name) });
    }
  }
  return items;
}

// files that run something: never opened without a click, even named by you
const RUNS = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|msi|msp|reg|scr|com|jar|hta|cpl|pif|command|sh|applescript|scpt|workflow|terminal)$/i;
const risky = (item) => item?.kind === 'file' && RUNS.test(item.id);

// Folders asked for by what they are ("ouvre mes téléchargements", "open the file explorer").
const FOLDERS = [
  ['explorer', /explorateur|file explorer|\bexplorer\b|ce pc|this pc|explorador|проводник/i],
  ['recycle', /corbeille|recycle bin|\btrash\b|papelera|lixeira|корзин/i],
  ['downloads', /t[ée]l[ée]chargements?|downloads?|descargas|transfer[êe]ncias|загрузк/i],
  ['desktop', /\bbureau\b|\bdesktop\b|escritorio|[áa]rea de trabalho|рабоч\S* стол/i],
  ['documents', /\bdocuments?\b|documentos|документ/i],
  ['pictures', /\bimages\b|\bphotos\b|\bpictures\b|im[áa]genes|\bfotos\b|imagens|изображени|фото/i],
  ['music', /dossier (de )?musique|music folder|carpeta de m[úu]sica|pasta de m[úu]sica|папк\S* (с )?музык/i],
  ['videos', /\bvid[ée]os\b|v[íi]deos|видео/i],
];

function knownFolder(text) {
  if (!WIN && !MAC) return null;
  const hit = FOLDERS.find(([, re]) => re.test(text));
  return hit ? { name: hit[0], kind: 'known', id: hit[0] } : null;
}

function openKnown(id) {
  if (MAC) {
    if (id === 'explorer') return spawn('open', ['-a', 'Finder'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    if (id === 'recycle') return shell.openPath(path.join(os.homedir(), '.Trash'));
    return shell.openPath(app.getPath(id));
  }
  if (id === 'explorer') return spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  if (id === 'recycle') return spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return shell.openPath(app.getPath(id));
}

// What you asked to open: an app or a game, something on your desktop, else a folder by what it is.
async function find(text) {
  return match([...desktopItems(), ...(await launchables())], text) || knownFolder(text);
}

// Opens one of them (only something she listed herself): a Start menu app through its AppsFolder
// entry (desktop and Store apps alike), a game through its launcher's link, a file or folder from
// your desktop, a folder by what it is.
async function launch({ kind, id } = {}) {
  if (kind === 'known') {
    if (!FOLDERS.some(([key]) => key === id)) throw new Error('not found');
    await openKnown(id);
    return undefined;
  }
  if (kind === 'file' || kind === 'folder') {
    if (!desktopItems().some((i) => i.id === id)) throw new Error('not found');
    const err = await shell.openPath(id);
    if (err) throw new Error(err);
    return undefined;
  }
  const item = (await launchables()).find((i) => i.kind === kind && i.id === id);
  if (!item) throw new Error('not found');
  if (kind === 'steam') return shell.openExternal(`steam://rungameid/${id}`);
  if (kind === 'epic') return shell.openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true`);
  if (MAC) {
    const err = await shell.openPath(id);
    if (err) throw new Error(err);
    return undefined;
  }
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return undefined;
}

// The media keys, as if pressed on the keyboard: whatever plays music (Spotify, a browser…) reacts.
// Play and pause are the same key; the volume moves a few steps at a time. Sent as keys (their virtual
// key codes), not typed: typed, they come out as "³" or "°" on a German keyboard.
const MEDIA = { pause: [0xb3, 1], play: [0xb3, 1], next: [0xb0, 1], previous: [0xb1, 1], volup: [0xaf, 5], voldown: [0xae, 5], mute: [0xad, 1] };
const KEY_DOWN = 1; // KEYEVENTF_EXTENDEDKEY
const KEY_UP = 3;   // ...and KEYEVENTF_KEYUP

async function media(action) {
  if (MAC) return macMedia(action);
  if (!WIN || !MEDIA[action]) return false;
  const [key, times] = MEDIA[action];
  return powershell(
    'Add-Type -Namespace Capri -Name Keys -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);\'; '
    + `1..${times} | ForEach-Object { [Capri.Keys]::keybd_event(${key}, 0, ${KEY_DOWN}, [UIntPtr]::Zero); [Capri.Keys]::keybd_event(${key}, 0, ${KEY_UP}, [UIntPtr]::Zero) }`,
  ).then(() => true, () => false);
}

// On a Mac the media keys aren't ours to press from a background app: volume goes through the
// system, and play/pause and the rest through Spotify or Music, when one of them is running.
function macMedia(action) {
  if (!MAC) return false;
  const run = (script) => new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err) => resolve(!err));
  });
  if (action === 'mute') return run('set volume output muted not (output muted of (get volume settings))');
  if (action === 'volup') return run('set volume output volume ((output volume of (get volume settings)) + 6.25)');
  if (action === 'voldown') return run('set volume output volume ((output volume of (get volume settings)) - 6.25)');
  const verb = { pause: 'playpause', play: 'playpause', next: 'next track', previous: 'previous track' }[action];
  if (!verb) return false;
  const player = ['Spotify', 'Music'].map((app) => `application "${app}"`);
  // whichever one answers: a player that isn't running just errors, and the next one is tried
  return run(`tell ${player[0]} to ${verb}`).then((ok) => ok || run(`tell ${player[1]} to ${verb}`));
}

// A Spotify search for it: in the app if it's installed, else on the web.
async function music(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return false;
  try {
    await shell.openExternal(`spotify:search:${encodeURIComponent(q)}`);
  } catch {
    await shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(q)}`);
  }
  return true;
}

// The song in Apple Music: Apple's own search (no key) finds it, and the Music app plays it. Music starts
// an album's queue from its first track and only when it was stopped, so she stops it, opens the song's
// page, plays, then skips to the song ({ at } in the album, discs counted first).
const ITUNES = 'https://itunes.apple.com';

async function appleTrack(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return null;
  const res = await fetch(`${ITUNES}/search?term=${encodeURIComponent(q)}&entity=song&limit=1&media=music`, {
    signal: AbortSignal.timeout(7000),
  });
  const hit = res.ok ? (await res.json())?.results?.[0] : null;
  if (!hit?.trackViewUrl) return null;
  let at = Number(hit.trackNumber) || 1;
  try {
    // where it sits in the album as the app queues it: disc 1's tracks, then disc 2's
    const album = await fetch(`${ITUNES}/lookup?id=${hit.collectionId}&entity=song&limit=200`, { signal: AbortSignal.timeout(7000) });
    const tracks = album.ok ? (await album.json())?.results?.filter((t) => t.wrapperType === 'track') || [] : [];
    tracks.sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
    const i = tracks.findIndex((t) => t.trackId === hit.trackId);
    if (i >= 0) at = i + 1;
  } catch {
    // no album list: its own track number is a good guess
  }
  return {
    title: hit.trackName,
    artist: hit.artistName,
    album: hit.collectionName || '',
    url: hit.trackViewUrl.replace(/^https:\/\/music\.apple\.com\//, 'music://music.apple.com/'),
    at,
  };
}

// One AppleScript answer: its last line, or null when it failed.
function oscript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 20000 }, (err, out) => resolve(err ? null : String(out).trim()));
  });
}

const titleKey = (s) => plain(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// What plays right now, or null.
async function nowPlaying() {
  const name = await oscript('tell application "Music" to get name of current track');
  if (name === null) return null;
  const album = await oscript('tell application "Music" to get album of current track');
  return { name, album: album || '' };
}

// Music starts an album's queue from its first track (and only when it was stopped): stop it, open the
// song's page, play, then skip to the song, checking as it goes. True when it is playing it.
async function applePlay(track) {
  const target = titleKey(track.title);
  for (let attempt = 0; attempt < 3; attempt++) {
    await oscript('tell application "Music" to stop');
    await shell.openExternal(track.url);
    await new Promise((r) => setTimeout(r, 1500 + attempt * 1500)); // the page has to be up first
    await oscript('tell application "Music" to play');
    await new Promise((r) => setTimeout(r, 800)); // and the queue takes a moment to start
    const start = await nowPlaying();
    // another album (the page hadn't loaded: it played what was there before): start over
    if (!start || titleKey(start.album) !== titleKey(track.album)) continue;
    const skips = Math.max(0, track.at - 1);
    if (skips) await oscript(`tell application "Music"\n  repeat ${skips} times\n    next track\n  end repeat\nend tell`);
    // the skips are queued in the app: wait for them to land on the song
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const now = await nowPlaying();
      if (now && titleKey(now.name) === target) return true;
    }
  }
  return false;
}

async function appleMusic(query) {
  const track = await appleTrack(query).catch(() => null);
  if (!track) {
    const q = String(query || '').trim().slice(0, 200);
    await shell.openExternal(`music://music.apple.com/us/search?term=${encodeURIComponent(q)}`);
    return { title: null, playing: false };
  }
  const playing = MAC ? await applePlay(track) : false;
  if (!playing) await shell.openExternal(track.url); // at least its page, ready to play
  return { title: track.title, artist: track.artist, playing };
}

// A song on YouTube, the exact video: the first result of a search (no key needed), opened in your
// browser. { title } of what it found, or { title: null } when it could only open the search.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const VIDEO = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/;

async function youtube(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return null;
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  let video = null;
  try {
    const res = await fetch(search, {
      // the consent cookie skips Europe's cookie page, which would hide the results
      headers: { 'user-agent': UA, 'accept-language': 'en', cookie: 'CONSENT=YES+1; SOCS=CAI' },
      signal: AbortSignal.timeout(8000),
    });
    const m = VIDEO.exec(await res.text());
    if (m) video = { id: m[1], title: JSON.parse(`"${m[2]}"`) };
  } catch {
    // offline or YouTube changed its page: the search still opens
  }
  await shell.openExternal(video ? `https://www.youtube.com/watch?v=${video.id}` : search);
  return { title: video?.title || null };
}

// A Roblox game by its name ("steal a brain rot"): the first one Roblox's own search gives, started
// straight in the Roblox app through its roblox:// link, or its page in the browser without the app.
// { name, app } of what it started, { name: null } if Roblox found nothing.
async function roblox(query) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return null;
  let game = null;
  try {
    const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&pageType=all&sessionId=${randomUUID()}`;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    game = (body.searchResults || []).filter((r) => r.contentGroupType === 'Game').flatMap((r) => r.contents || [])[0] || null;
  } catch {
    return null;
  }
  if (!game?.rootPlaceId) return { name: null };
  const installed = Boolean(app.getApplicationNameForProtocol('roblox://'));
  await shell.openExternal(installed ? `roblox://experiences/start?placeId=${game.rootPlaceId}` : `https://www.roblox.com/games/${game.rootPlaceId}`);
  // "[💀] Steal a Brainrot" is "Steal a Brainrot"
  const name = String(game.name).replace(/\[[^\]]*\]\s*/g, '').replace(/[\p{Extended_Pictographic}️]/gu, '').trim();
  return { name: name || game.name, app: installed };
}

// A website: http or https, with a real host name.
function siteUrl(address) {
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

async function site(address) {
  const url = siteUrl(String(address || '').trim());
  if (!url) return false;
  await shell.openExternal(url.toString());
  return true;
}

module.exports = { launchables, match, find, launch, media, music, appleMusic, youtube, roblox, site, siteUrl, risky };
