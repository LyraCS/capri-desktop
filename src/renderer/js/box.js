// Her facecam: a square tile with her face in it, cut like the rest of her interface. It shows up when
// you're not in a terminal or an editor (main.js decides), moves to the song, and stands still on pause.
// Her faces are the sheets in assets/capri/ (sprites.png, and song vibes.png for when music plays), cut
// one picture per cell by tools/cut-faces.swift; she shuffles them the whole time she's in the tile,
// and keeps the ones that fit what she's doing. Unless the person running her put pictures of their
// own in ~/Library/Application Support/capri-desktop/faces: those win, and no art ships with her.

const host = window.host;
const DIR = '../../assets/capri/';

// Her faces, when nobody put their own in her folder: the eight that came with her — the same art her
// panel wears — cycled over the names the moods below ask for. The generated sheet she used to be cut
// from is gone, and the vibes sheet with it.
const ART = ['capri-face.png', 'face-look.png', 'face-laugh.png', 'face-smug.png',
  'face-aside.png', 'face-wide.png', 'face-many.png', 'face-calm.png'];
const NAMES = [
  'grin', 'laugh', 'star', 'angry', 'huh', 'sleepy', 'love', 'shock', 'sad', 'smug',
  'cry', 'bored', 'dizzy', 'blush', 'terror', 'doze', 'wink', 'glare', 'fang', 'shy',
  'peek', 'roar', 'teary', 'wow', 'blep',
  'vibe1', 'vibe2', 'vibe3', 'vibe4', 'vibe5', 'vibe6', 'vibe7', 'vibe8', 'vibe9', 'vibe10',
];
const FACES = Object.fromEntries(NAMES.map((name, i) => [name, ART[i % ART.length]]));

// what she cycles through: idling, working, waiting on you, asleep, and while music plays
const MOODS = {
  idle: ['grin', 'huh', 'love', 'smug', 'peek', 'blep', 'wink', 'blush', 'bored', 'star', 'shy', 'blep'],
  work: ['glare', 'angry', 'dizzy', 'fang', 'smug', 'grin'],
  alert: ['shock', 'terror', 'wow', 'huh'],
  sleep: ['sleepy', 'doze', 'sad', 'teary'],
  play: ['vibe1', 'vibe2', 'vibe3', 'vibe4', 'vibe5', 'vibe6', 'vibe7', 'vibe8', 'vibe9', 'vibe10'],
};

const cam = document.getElementById('cam');
const face = document.getElementById('face');
const beat = document.getElementById('beat');
const foot = document.getElementById('foot');
const art = document.getElementById('art');
const title = document.getElementById('title');
const artist = document.getElementById('artist');

// The set switching on. Main says when the window is really up (box:show): at startup the animation
// used to play into a window that was still hidden, so you never saw it; toggling the tile later
// raced the window and you did.
function powerOn() {
  cam.classList.remove('is-on');
  void cam.offsetWidth; // restart it
  cam.classList.add('is-on');
}
host.onBoxShow(powerOn);

let mode = 'idle';
let playing = false;
let last = null;
let shuffleTimer = null;
let joltTimer = null;

// What a tube does when it loses the picture for a moment — and gets it back. Everything the old
// glitch sheet did (torn bands, colour fringing) is gone: this is only sync, roll, squeeze and the
// brightness dipping, which is what a CRT actually does, and it never eats her face.
const JOLT_MS = 240;
const JOLT_STEP = 1000 / 30; // two display frames at 60Hz, four at 120: 30fps, like the rest of her
const JOLTS = {
  // an expression change: the picture slides and re-syncs (a touch oversize, so the slide shows no edge)
  sync: () => [`translateY(${(Math.random() * 12 - 6).toFixed(1)}px) scale(1.06) scaleY(${(1 + Math.random() * 0.04).toFixed(3)})`, 1.1 + Math.random() * 0.5],
  // vertical hold slipping: the picture runs up or down the tube
  roll: () => [`translateY(${(Math.random() * 52 - 26).toFixed(1)}px) scale(1.06)`, 0.9 + Math.random() * 0.5],
  // the frame stretches, like the set reletting — it must never shrink: a picture smaller than its
  // window leaves black bars, and the one on the right hides behind the strip while the left shows
  squeeze: () => [`scaleX(${(1.02 + Math.random() * 0.06).toFixed(3)}) scaleY(${(1 + Math.random() * 0.04).toFixed(3)})`, 1.2 + Math.random() * 0.6],
  // the brightness dropping out of it for a frame or two
  dip: () => ['', 0.35 + Math.random() * 0.4],
};
let joltUntil = 0;
let joltRAF = 0;
let joltAt = 0;
let joltKind = 'sync';

function still(el) {
  el.style.transform = '';
  el.style.filter = '';
}

function jolt(kind = 'sync', ms = JOLT_MS) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  joltKind = JOLTS[kind] ? kind : 'sync';
  joltUntil = Math.max(joltUntil, performance.now() + ms);
  if (joltRAF) return;
  const step = (now) => {
    joltRAF = 0;
    if (now >= joltUntil) {
      still(face);
      return;
    }
    joltRAF = requestAnimationFrame(step);
    // four milliseconds of slack: a frame served at 33.4ms must not read as "not yet 33.33" and cost
    // a whole step, which is how a 30fps run ends up at 20
    if (now - joltAt < JOLT_STEP - 4) return;
    joltAt = now;
    const [transform, light] = JOLTS[joltKind]();
    face.style.transform = transform;
    face.style.filter = `brightness(${light.toFixed(2)}) contrast(1.08)`;
  };
  joltRAF = requestAnimationFrame(step);
}

// And now and then, unprompted: a tube that has been on for a while does something. More often when
// she's waiting on you or music is playing, and never in the middle of nothing worth watching.
function scheduleJolt() {
  clearTimeout(joltTimer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const busy = mode === 'alert' || playing;
  const wait = busy ? 12000 + Math.random() * 18000 : 22000 + Math.random() * 26000;
  joltTimer = setTimeout(() => {
    const kinds = busy ? ['dip', 'roll', 'squeeze', 'sync'] : ['dip', 'roll'];
    jolt(kinds[Math.floor(Math.random() * kinds.length)], 140 + Math.random() * 220);
    scheduleJolt();
  }, wait);
}

// where the picture for a face name lives: the user's folder (capri://userfaces) when there is one,
// else the sheet that ships
const srcOf = (name) => {
  const file = FACES[name] || FACES.grin;
  return file.includes('://') ? file : DIR + file;
};

// A new expression, the way a set changes channel: the picture slips for a moment, then it's her new
// face, settled.
function wear(name, { jolt: animate = true } = {}) {
  const src = srcOf(name);
  if (face.getAttribute('src') === src) return;
  face.setAttribute('src', src);
  if (!animate) return;
  jolt('sync');
}

function faces() {
  if (mode === 'alert') return MOODS.alert; // she needs you: that wins over the music
  if (playing) return MOODS.play;
  return MOODS[mode] || MOODS.idle;
}

// A new face from the set that fits, never the same twice in a row; while she waits on you (alert)
// or sleeps, she keeps the one she has.
function shuffle() {
  const list = faces();
  let name = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && name === last) name = list[(list.indexOf(name) + 1) % list.length];
  last = name;
  wear(name);

  clearTimeout(shuffleTimer);
  if (mode === 'alert' || mode === 'sleep') return;
  const base = mode === 'work' ? 8000 : playing ? 6500 : 9500;
  shuffleTimer = setTimeout(shuffle, base + Math.random() * 5500);
}

function setMode(next) {
  mode = MOODS[next] ? next : 'idle';
  cam.dataset.mode = mode;
  shuffle();
}

function setPlaying(on) {
  if (playing === on) return;
  playing = on;
  shuffle();
}

// her bob stays at a tempo of her own, 96 to 128
function bpmOf(name = '', by = '') {
  let n = 0;
  for (const c of `${name}${by}`) n = (n * 31 + c.charCodeAt(0)) % 997;
  return 96 + (n % 33);
}

function paintMusic(m) {
  const on = Boolean(m?.playing);
  cam.dataset.playing = on ? 'on' : 'off';
  if (on) beat.style.setProperty('--beat', `${(60 / bpmOf(m.title, m.artist)).toFixed(3)}s`);
  foot.hidden = !on;
  setPlaying(on);
  if (!on) return;
  title.textContent = m.title || '';
  artist.textContent = m.artist || '';
  art.hidden = !m.art;
  if (m.art) art.src = m.art;
}

async function boot() {
  const cfg = await host.getConfig();
  document.documentElement.lang = cfg.lang;
  await Promise.all([
    document.fonts.load('700 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  // Their own pictures, if they put any in her faces folder (file:// urls from main): one per
  // expression name, in turn, so the moods she has (sleepy, playing…) still work. Their folder wins,
  // then the pack that ships in assets/capri/faces, then the eight faces she came with.
  const { mine = [], shipped = [] } = await host.listFaces().catch(() => ({}));
  const art = mine.length ? mine : shipped;
  if (art.length) {
    const names = Object.keys(FACES);
    names.forEach((name, i) => { FACES[name] = art[i % art.length]; });
  }
  // every face decoded now, so a change doesn't blink
  await Promise.all(Object.values(FACES).map((file) => new Promise((done) => {
    const img = new Image();
    img.onload = done;
    img.onerror = done;
    img.src = file.includes('://') ? file : DIR + file;
  })));

  setMode('idle');
  scheduleJolt();

  host.onMusic(paintMusic);
  host.musicNow().then(paintMusic).catch(() => {});
  host.onBoxMode(setMode);
  host.onBoxSleep(() => setMode('sleep'));
  host.onBoxWake(() => setMode('idle'));

  document.getElementById('talk').addEventListener('click', () => host.boxChat());
  document.getElementById('close').addEventListener('click', () => host.boxClose());
}

boot().catch((err) => console.error('[facecam]', err));
