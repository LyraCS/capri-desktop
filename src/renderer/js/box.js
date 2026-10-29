// Her facecam: a square tile with her face in it, cut like the rest of her interface. It shows up when
// you're not in a terminal or an editor (main.js decides), moves to the song, and stands still on pause.

const host = window.host;
const DIR = '../../assets/capri/';
const FACES = {
  grin: 'capri-face.png',
  calm: 'face-calm.png',
  aside: 'face-aside.png',
  smug: 'face-smug.png',
  wide: 'face-wide.png',
  look: 'face-look.png',
  laugh: 'face-laugh.png',
  many: 'face-many.png',
};
const MODE_FACE = { idle: 'grin', work: 'look', alert: 'wide', sleep: 'aside' };
const DRIFT = ['grin', 'smug', 'look', 'calm', 'grin', 'aside'];

const cam = document.getElementById('cam');
const face = document.getElementById('face');
const beat = document.getElementById('beat');
const foot = document.getElementById('foot');
const art = document.getElementById('art');
const title = document.getElementById('title');
const artist = document.getElementById('artist');

let mode = 'idle';
let driftTimer = null;
let revertTimer = null;

// A new expression, hard-cut like her art: a glitch, then the new face.
function wear(name, { glitch = true } = {}) {
  const src = DIR + (FACES[name] || FACES.grin);
  if (face.getAttribute('src') === src) return;
  face.setAttribute('src', src);
  if (!glitch || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  face.classList.remove('is-glitch');
  void face.offsetWidth; // restart the animation
  face.classList.add('is-glitch');
}

// While she's just there, her face drifts now and then: watching, the fang, eyes on you.
function drift() {
  clearTimeout(driftTimer);
  if (mode !== 'idle') return;
  driftTimer = setTimeout(() => {
    if (mode !== 'idle') return;
    wear(DRIFT[Math.floor(Math.random() * DRIFT.length)]);
    clearTimeout(revertTimer);
    revertTimer = setTimeout(() => mode === 'idle' && wear('grin'), 5000);
    drift();
  }, 20000 + Math.random() * 22000);
}

function setMode(next) {
  mode = MODE_FACE[next] ? next : 'idle';
  cam.dataset.mode = mode;
  wear(MODE_FACE[mode]);
  drift();
}

// her bob stays at a tempo of her own, 96 to 128
function bpmOf(name = '', by = '') {
  let n = 0;
  for (const c of `${name}${by}`) n = (n * 31 + c.charCodeAt(0)) % 997;
  return 96 + (n % 33);
}

function paintMusic(m) {
  const playing = Boolean(m?.playing);
  cam.dataset.playing = playing ? 'on' : 'off';
  if (playing) beat.style.setProperty('--beat', `${(60 / bpmOf(m.title, m.artist)).toFixed(3)}s`);
  foot.hidden = !playing;
  if (!playing) return;
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

  wear('grin', { glitch: false });
  setMode('idle');

  host.onMusic(paintMusic);
  host.musicNow().then(paintMusic).catch(() => {});
  host.onBoxMode(setMode);
  host.onBoxSleep(() => setMode('sleep'));
  host.onBoxWake(() => setMode('idle'));

  document.getElementById('talk').addEventListener('click', () => host.boxChat());
  document.getElementById('close').addEventListener('click', () => host.boxClose());
}

boot().catch((err) => console.error('[facecam]', err));
