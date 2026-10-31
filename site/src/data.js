import done from './img/done.png';
import victory from './img/victory.png';
import star from './img/star.png';

// Everything a person might want to change lives here: the version, the links,
// the words. Components render it; none of them hold copy of their own.
export const VERSION = '1.2.4';

export const LINKS = {
  release: 'https://github.com/LyraCS/capri-desktop/releases/latest',
  repo: 'https://github.com/LyraCS/capri-desktop',
  readme: 'https://github.com/LyraCS/capri-desktop#readme',
  macNotes: 'https://github.com/LyraCS/capri-desktop/blob/macos-opencode/MACOS.md',
  license: 'https://github.com/LyraCS/capri-desktop/blob/macos-opencode/LICENSE',
  upstream: 'https://github.com/mochiiwuff/capri-desktop',
  author: 'https://github.com/mochiiwuff',
  fork: 'https://github.com/LyraCS',
};

export const NAV = [
  { href: '#does', label: 'what she does' },
  { href: '#agents', label: 'agents' },
  { href: '#credits', label: 'credits' },
  { href: '#download', label: 'download' },
];

export const AGENTS = ['Claude Code', 'Codex', 'Antigravity', 'OpenCode'];

export const CARDS = [
  {
    tag: 'DONE',
    img: done,
    alt: "Capri beside her panel, which shows the run summary and the agent's last sentence.",
    title: "She reports, she doesn't interrupt",
    body: 'Twelve actions, three files changed, two minutes fourteen — plus the last thing the agent said. In her own panel, in the corner it left room in.',
  },
  {
    tag: 'STOP',
    img: victory,
    alt: "Capri's victory: a stretched smear frame under manga speed lines, then an anime cut-in of her grin.",
    title: "When it's over, she celebrates",
    body: 'A wind-up, a smear frame, arms up and the mane exploding under speed lines. A manic laugh, an anime cut-in, then she settles back down and gets to the point.',
  },
  {
    tag: 'UPLINK',
    img: star,
    alt: "Capri's satellite sequence: her mane's white specks line up into a road of stars leading to a satellite.",
    title: 'The satellite, kept for moments that matter',
    body: "First light of the day, or after a long job. The specks of her mane lift off as a constellation, line up into a road from her fingers, and the red light goes up.",
  },
];

export const SPECS = [
  ['platform', 'macOS 13+ · Apple Silicon · Intel from source'],
  ['agent', 'Claude Code, Codex, Antigravity, OpenCode'],
  ['speaks', 'French, English, Spanish, Portuguese, Russian'],
];
