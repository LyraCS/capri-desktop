'use strict';
// Her chat with tools: the model asks for one, she runs it (the same action as before), and asks
// again with what came of it. And without tools, the old plain-language path still does the job.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function moduleUrl(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/from '(\.\/[^']+)'/g,
    (_, relative) => `from '${moduleUrl(path.resolve(path.dirname(file), relative))}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const noop = () => {};

// What Chat touches on the overlay, in the smallest shape it will accept. `rounds`: the tool calls
// the model makes, one list per question it is asked (the last round answers with `answer`).
function stage({
  tools = true, answer = 'On it.', brain,
  rounds = [[{ id: 'call_1', name: 'play_music', arguments: { song: 'daft punk' } }]],
} = {}) {
  const streamed = [];
  const requests = [];
  const played = [];
  const sites = [];
  const opened = [];
  const actionRows = [];
  const panel = new Proxy({
    say: () => ({}),
    stream: (text) => streamed.push(text),
    setChatBusy: noop,
    chatTurn: noop,
    setFace: noop,
    setActions: (actions) => { if (actions?.length) actionRows.push(actions); },
    chatInput: { focus: noop },
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  const capri = new Proxy({
    windows: { fg: null, wins: [] },
    head: () => ({ x: 0, y: 0 }),
    perform: noop,
    pulse: noop,
    zap: noop,
    wake: noop,
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  const host = new Proxy({
    onChatDelta: noop,
    chatStatus: async () => ({ ok: true, provider: 'deepseek', model: 'deepseek-chat', agent: false, local: false, tools }),
    chatMemory: async () => [],
    chatRemember: noop,
    openApps: async () => [],
    focusOverlay: noop,
    getConfig: async () => ({ musicService: 'youtube' }),
    youtube: async (song) => { played.push(song); return { title: `Daft Punk - ${song}` }; },
    openSite: async (address, app) => { sites.push({ address, app }); return true; },
    readFile: async (file) => (/notes/i.test(file) ? { name: 'notes.md', text: 'the milk is off' } : null),
    openFile: async (file, reveal) => { opened.push({ file, reveal: Boolean(reveal) }); return true; },
    clipboard: async () => 'https://example.com/invoice-4821',
    findLaunch: async (name) => (/safari/i.test(name) ? { name: 'Safari', kind: 'app', id: 'Safari' } : null),
    launch: async () => ({ ok: true }),
    chatSend: async ({ messages, tools }) => {
      requests.push({ messages: messages.map((m) => ({ ...m })), tools });
      const calls = tools ? rounds[requests.length - 1] || [] : [];
      return calls.length ? { ok: true, text: '', calls } : { ok: true, text: answer, calls: [] };
    },
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  return {
    host, panel, capri, streamed, requests, played, sites, opened, actionRows,
    voice: { play: noop },
    brain: { t: brain, custom: {}, watching: true, assistant: 'claude', lang: 'en', context: () => 'Claude is idle.' },
  };
}

test('her chat with tools: the model plays a song through her tool, then answers', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const s = stage({ brain: linesFor('en', 'claude') });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });

  await chat.start();
  assert.equal(chat.useTools, true);
  await chat.send('play daft punk');

  // one question, one tool, one more question with its result
  assert.equal(s.requests.length, 2);
  assert.ok(Array.isArray(s.requests[0].tools) && s.requests[0].tools.some((tool) => tool.function.name === 'play_music'));
  const assistant = s.requests[1].messages.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.equal(assistant.tool_calls[0].function.name, 'play_music');
  assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), { song: 'daft punk' });
  const result = s.requests[1].messages.at(-1);
  assert.equal(result.role, 'tool');
  assert.equal(result.tool_call_id, 'call_1');
  assert.match(result.content, /playing: daft punk/);

  // the action itself, and her line under the answer, are the ones she already had
  assert.deepEqual(s.played, ['daft punk']);
  assert.match(s.streamed.at(-1), /^On it\.\n.*daft punk/i);
  assert.equal(chat.tooled, true);
  assert.equal(chat.history.at(-1).content, 'On it.');
});

test('without tools (a provider that cannot take them), her plain-language path still plays it', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const s = stage({ tools: false, answer: 'Sure.', brain: linesFor('en', 'claude') });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });

  await chat.start();
  assert.equal(chat.useTools, false);
  await chat.send('play daft punk');

  assert.equal(s.requests[0].tools, null);
  assert.deepEqual(s.played, ['daft punk']);
  assert.equal(chat.tooled, false);
  assert.match(s.streamed.at(-1), /^Sure\.\n/);
});

test('one message, two things: the site opens in the app she named, not just the app', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  // what "open safari and go to youtube" got: the browser first, then the site in it
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [
      [{ id: 'call_1', name: 'open_app', arguments: { name: 'safari' } }],
      [{ id: 'call_2', name: 'open_site', arguments: { address: 'https://www.youtube.com', app: 'Safari' } }],
    ],
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('open safari and go to youtube');

  // it is opened in Safari, with the address they named, and no button to click
  assert.deepEqual(s.sites, [{ address: 'https://www.youtube.com', app: 'Safari' }]);
  assert.equal(s.actionRows.length, 0);
  assert.match(s.streamed.at(-1), /youtube\.com: open\.$/);
  // and the first tool's result tells it to finish the sentence
  const first = s.requests[1].messages.at(-1);
  assert.match(first.content, /open_site/);
});

test('a site only the model thought of still waits for its button', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [[{ id: 'call_1', name: 'open_site', arguments: { address: 'https://example.com/watch' } }]],
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('find me something to watch');

  assert.deepEqual(s.sites, []);
  assert.ok(s.actionRows.some((actions) => actions.some((action) => action.id === 'site')), 'a site button');
});

test('the model says the address wrong ("youtube"): the site she named still opens, in Safari', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  // a flash model doing both, and getting the address refused as "not a web address"
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [[
      { id: 'call_1', name: 'open_app', arguments: { name: 'safari' } },
      { id: 'call_2', name: 'open_site', arguments: { address: 'youtube' } },
    ]],
    answer: 'Safari is up, YouTube is riding shotgun.',
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('open safari and go to youtube');

  assert.deepEqual(s.sites, [{ address: 'https://www.youtube.com', app: 'Safari' }]);
  assert.match(s.streamed.at(-1), /youtube\.com: open\./);
});

test('without tools, the same message opens the site too, in the browser it names', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const s = stage({ tools: false, brain: linesFor('en', 'claude'), answer: 'Sure.' });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('open safari and go to youtube');

  // not just Safari: the site, in it
  assert.deepEqual(s.sites, [{ address: 'https://www.youtube.com', app: 'Safari' }]);
  assert.match(s.streamed.at(-1), /youtube\.com: open\./);
});

test('she reads a file, opens one, and reads what you copied', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const file = '/Users/lyra/notes.md';
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [[
      { id: 'c1', name: 'read_file', arguments: { file } },
      { id: 'c2', name: 'open_file', arguments: { file } },
      { id: 'c3', name: 'read_clipboard', arguments: {} },
    ]],
    answer: 'Your note says the milk is off, and the link you copied is an invoice.',
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('what is in my notes, and what did I copy?');

  // what the model is handed: the file's text, what happened, the clipboard
  const results = s.requests[1].messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(results[0], /the milk is off/);
  assert.match(results[1], new RegExp(`opened ${file}`));
  assert.match(results[2], /invoice-4821/);
  // the file itself, opened; and her line under the answer
  assert.deepEqual(s.opened, [{ file, reveal: false }]);
  assert.match(s.streamed.at(-1), /notes\.md: on it\./);
});

test('a file she never found is not read: the model is told to search first', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [[{ id: 'c1', name: 'read_file', arguments: { file: '/etc/passwd' } }]],
    answer: 'I could not read that.',
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('read that file');

  assert.match(s.requests[1].messages.at(-1).content, /search_files first/);
});

test('a weaker model that opens the app and stops: the site she named still opens in it', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const { linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  // exactly what happened: it opened Safari, answered, and never asked for the site
  const s = stage({
    brain: linesFor('en', 'claude'),
    rounds: [[{ id: 'call_1', name: 'open_app', arguments: { name: 'safari' } }]],
    answer: 'Safari is up, YouTube is coming.',
  });
  const chat = new Chat({ capri: s.capri, panel: s.panel, voice: s.voice, host: s.host, brain: s.brain });
  await chat.start();
  await chat.send('open safari and go to youtube');

  assert.deepEqual(s.sites, [{ address: 'https://www.youtube.com', app: 'Safari' }]);
  assert.match(s.streamed.at(-1), /Safari: on it\./);
  assert.match(s.streamed.at(-1), /youtube\.com: open\./);
});
