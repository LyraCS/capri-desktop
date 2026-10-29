// Her facecam: a square tile with her face in it, cut like the rest of her interface. It shows up when
// you're not in a terminal or an editor (main.js decides), moves to the song, and stands still on pause.
// Her faces are the sheet in assets/capri/sprites.png, cut one picture per cell by tools/cut-faces.swift;
// she shuffles them the whole time she's in the tile, and keeps the ones that fit what she's doing.

const host = window.host;
const DIR = '../../assets/capri/faces/';

// row by row, as cut: f01 top left, f25 bottom right
const FACES = {
  grin: 'f01.png', //   big grin, all fangs
  laugh: 'f02.png', //  eyes shut, laughing
  star: 'f03.png', //   star eyes, sparkles
  angry: 'f04.png', //  cross, the vein popping
  huh: 'f05.png', //    a question mark over her
  sleepy: 'f06.png', // Zzz
  love: 'f07.png', //   heart eyes
  shock: 'f08.png', //  the "!!"
  sad: 'f09.png', //    a sweat drop
  smug: 'f10.png', //   tongue out, smug
  cry: 'f11.png', //    a waterfall of tears
  bored: 'f12.png', //  a "..." bubble
  dizzy: 'f13.png', //  spiral eyes
  blush: 'f14.png', //  flustered
  terror: 'f15.png', // huge white eyes
  doze: 'f16.png', //   half shut
  wink: 'f17.png', //   a wink and a star
  glare: 'f18.png', //  eyes on you, not amused
  fang: 'f19.png', //   the sharp grin
  shy: 'f20.png', //    hiding her eyes
  peek: 'f21.png', //   one eye, sideways
  roar: 'f22.png', //   shouting
  teary: 'f23.png', //  welling up
  wow: 'f24.png', //    round eyes, a little o
  blep: 'f25.png', //   tongue, again
};

// what she cycles through: idling, working, waiting on you, asleep, and while music plays
const MOODS = {
  idle: ['grin', 'huh', 'love', 'smug', 'peek', 'blep', 'wink', 'blush', 'bored', 'star', 'shy', 'blep'],
  work: ['glare', 'angry', 'dizzy', 'fang', 'smug', 'grin'],
  alert: ['shock', 'terror', 'wow', 'huh'],
  sleep: ['sleepy', 'doze', 'sad', 'teary'],
  play: ['laugh', 'star', 'love', 'wink', 'blep', 'smug', 'grin'],
};

// the pieces cut out of assets/capri/glitch.png (tools/cut-glitch.swift), flashed over her face
const GLITCH = Array.from({ length: 90 }, (_, i) => `../../assets/capri/glitch/g${String(i + 1).padStart(2, '0')}.png`);

const cam = document.getElementById('cam');
const face = document.getElementById('face');
const glitchLayer = document.getElementById('glitch');
const beat = document.getElementById('beat');
const foot = document.getElementById('foot');
const art = document.getElementById('art');
const title = document.getElementById('title');
const artist = document.getElementById('artist');

let mode = 'idle';
let playing = false;
let last = null;
let shuffleTimer = null;
let glitchTimer = null;

// One short burst of interference: a piece from her glitch sheet, somewhere over her face.
function flash(n = 1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const img = new Image();
    img.alt = '';
    // the bigger pieces read best: most bursts take one of those
    const big = Math.random() < 0.7;
    img.src = GLITCH[Math.floor(Math.random() * (big ? 34 : GLITCH.length))];
    const width = 38 + Math.random() * 66; // % of the tile: bands right across it
    img.style.width = `${width}%`;
    img.style.left = `${Math.random() * Math.max(0, 100 - width * 0.7)}%`;
    img.style.top = `${Math.random() * 88}%`;
    const life = 220 + Math.random() * 340;
    img.style.opacity = `${(0.9 + Math.random() * 0.1).toFixed(2)}`;
    glitchLayer.appendChild(img);
    // hard on, hard off, like a torn frame: no fade to miss
    setTimeout(() => img.remove(), life);
  }
}

// More of it when she's tense (waiting on you) or a song is playing, less when it's quiet.
function scheduleGlitch() {
  clearTimeout(glitchTimer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const busy = mode === 'alert' || playing;
  const wait = busy ? 240 + Math.random() * 420 : 480 + Math.random() * 900;
  glitchTimer = setTimeout(() => {
    flash(2 + Math.floor(Math.random() * 3)); // two to four bands
    scheduleGlitch();
  }, wait);
}

// A new expression, hard-cut like her art: a glitch, then the new face.
function wear(name, { glitch = true } = {}) {
  const src = DIR + (FACES[name] || FACES.grin);
  if (face.getAttribute('src') === src) return;
  face.setAttribute('src', src);
  if (!glitch || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  face.classList.remove('is-glitch');
  void face.offsetWidth; // restart the animation
  face.classList.add('is-glitch');
  flash(2); // and some of her glitch sheet with the cut
}

function faces() {
  return playing && mode === 'idle' ? MOODS.play : MOODS[mode] || MOODS.idle;
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
  if (mode === 'idle') shuffle();
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
  // every face decoded now, so a change doesn't blink
  await Promise.all(Object.values(FACES).map((file) => new Promise((done) => {
    const img = new Image();
    img.onload = done;
    img.onerror = done;
    img.src = DIR + file;
  })));

  setMode('idle');
  for (const src of GLITCH) { const warm = new Image(); warm.src = src; } // no blink on the first burst
  scheduleGlitch();

  host.onMusic(paintMusic);
  host.musicNow().then(paintMusic).catch(() => {});
  host.onBoxMode(setMode);
  host.onBoxSleep(() => setMode('sleep'));
  host.onBoxWake(() => setMode('idle'));

  document.getElementById('talk').addEventListener('click', () => host.boxChat());
  document.getElementById('close').addEventListener('click', () => host.boxClose());
}

boot().catch((err) => console.error('[facecam]', err));
