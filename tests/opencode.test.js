'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createBridge } = require('../src/main/bridge');

// The plugin is a V2 server module (export default { id, setup }): load it as ESM, the same text
// OpenCode would.
function moduleUrl(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/from '(\.\/[^']+)'/g,
    (_, relative) => `from '${moduleUrl(path.resolve(path.dirname(file), relative))}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const until = async (check, ms = 3000) => {
  const at = Date.now();
  while (!check()) {
    if (Date.now() - at > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

// A stand-in for OpenCode's plugin context: records the hooks it asks for, and lets the test
// push session events the way the server would.
function fakeContext(directory) {
  const hooks = {};
  const queue = [];
  const waiters = [];
  const emit = (event) => {
    queue.push(event);
    for (const wake of waiters.splice(0)) wake();
  };
  const register = (domain) => (name, callback) => {
    hooks[`${domain}.${name}`] = callback;
    return Promise.resolve({ dispose() {} });
  };
  return {
    hooks,
    emit,
    ctx: {
      location: { directory },
      session: { hook: register('session') },
      tool: { hook: register('tool') },
      permission: { hook: register('permission') },
      event: {
        subscribe: async function* () {
          for (;;) {
            if (!queue.length) await new Promise((wake) => waiters.push(wake));
            while (queue.length) yield queue.shift();
          }
        },
      },
    },
  };
}

test('OpenCode plugin: prompts, tools, permissions and turns arrive as Capri events; Brain follows it', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Brain } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/brain.js')));

  const events = [];
  const pending = [];
  const server = createBridge({ port: 0, onEvent(evt) { events.push(evt); pending.push(brain.handle(evt)); } });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.CAPRI_PORT = String(server.address().port);
  t.after(() => { delete process.env.CAPRI_PORT; });

  const plugin = (await import(moduleUrl(path.join(__dirname, '../hooks/opencode/capri-opencode.ts')))).default;
  assert.equal(plugin.id, 'capri');
  const fake = fakeContext('/project');
  const stop = await plugin.setup(fake.ctx);
  t.after(() => stop());

  const messages = [];
  const noop = () => {};
  const stub = (obj) => new Proxy(obj, { get: (o, key) => (key in o ? o[key] : noop) });
  const brain = new Brain({
    capri: stub({ windows: { fg: null, wins: [] }, mode: 'idle', setMode(mode) { this.mode = mode; }, celebrate({ onSpeak }) { onSpeak(); } }),
    panel: stub({ say(msg) { messages.push(msg); }, setTicker() {} }),
    voice: { play: noop }, host: { cursor: async () => null }, lang: 'en', assistant: 'opencode',
  });
  t.after(() => clearInterval(brain.thinkTimer));

  const settle = async (count) => {
    await until(() => events.length >= count);
    await new Promise((r) => setTimeout(r, 20));
    await Promise.all(pending);
  };

  // the session is announced, then you type
  fake.emit({ type: 'session.created', data: { sessionID: 's1', title: 'Night City API', location: { directory: '/project' } } });
  await settle(1);
  assert.equal(events[0].hook_event_name, 'SessionStart');
  assert.equal(events[0].session_id, 'opencode:s1');
  assert.equal(events[0].cwd, '/project');
  assert.equal(events[0].session_title, 'Night City API');

  await fake.hooks['session.prompt']({ sessionID: 's1', prompt: { text: 'Run the tests' } });
  await settle(2);
  assert.equal(events[1].hook_event_name, 'UserPromptSubmit');
  assert.equal(events[1].prompt, 'Run the tests');

  // camelCase input, OpenCode's tool name: what she reads is Claude Code's
  await fake.hooks['tool.execute.before']({ sessionID: 's1', id: 'call1', tool: 'edit', input: { filePath: '/project/a.js', oldString: 'a', newString: 'b' } });
  await settle(3);
  assert.equal(events[2].hook_event_name, 'PreToolUse');
  assert.equal(events[2].tool_name, 'Edit');
  assert.equal(events[2].tool_input.file_path, '/project/a.js');
  assert.equal(events[2].tool_use_id, 'call1');
  assert.equal(events[2].tool_input.old_string_len, 1);

  await fake.hooks['tool.execute.after']({ sessionID: 's1', id: 'call1', tool: 'edit', input: {}, status: 'completed', result: {} });
  await settle(4);
  assert.equal(events[3].hook_event_name, 'PostToolUse');

  // a permission prompt, not an auto-allowed call
  await fake.hooks['permission.evaluate']({ sessionID: 's1', action: 'bash', resources: ['npm test'], effect: 'ask' });
  await settle(5);
  assert.equal(events[4].hook_event_name, 'Notification');
  assert.equal(events[4].notification_type, 'permission_prompt');
  assert.match(events[4].message, /npm test/);
  assert.equal(brain.sessions.get('opencode:s1').waiting, true);

  await fake.hooks['permission.evaluate']({ sessionID: 's1', action: 'read', resources: ['/project/a.js'], effect: 'allow' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events.length, 5); // nothing to point at

  // the answer, then the turn ends
  fake.emit({ type: 'session.text.ended', data: { sessionID: 's1', text: 'All green.' } });
  fake.emit({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });
  await settle(6);
  assert.equal(events[5].hook_event_name, 'Stop');
  assert.equal(events[5].last_assistant_message, 'All green.');
  assert.equal(brain.sessions.get('opencode:s1').working, false);
  assert.equal(messages.at(-1).quote, 'All green.');

  // a failed tool and an interrupted turn are her kinds of bad news, not OpenCode decisions
  await fake.hooks['tool.execute.after']({ sessionID: 's1', id: 'call2', tool: 'bash', input: { command: 'false' }, status: 'error', error: { message: 'exit 1' } });
  await settle(7);
  assert.equal(events[6].hook_event_name, 'PostToolUseFailure');
  assert.equal(events[6].error, 'exit 1');

  fake.emit({ type: 'session.execution.interrupted', data: { sessionID: 's1', reason: 'user' } });
  await settle(8);
  assert.equal(events[7].hook_event_name, 'Interrupt');

  fake.emit({ type: 'session.deleted', data: { sessionID: 's1' } });
  await settle(9);
  assert.equal(events[8].hook_event_name, 'SessionEnd');
  assert.equal(brain.sessions.has('opencode:s1'), false);
});

test('OpenCode plugin never needs Capri to be running, and never writes anything', async (t) => {
  const plugin = (await import(moduleUrl(path.join(__dirname, '../hooks/opencode/capri-opencode.ts')))).default;
  process.env.CAPRI_PORT = '1'; // nothing listens there
  t.after(() => { delete process.env.CAPRI_PORT; });
  const fake = fakeContext('/project');
  const stop = await plugin.setup(fake.ctx);
  await fake.hooks['session.prompt']({ sessionID: 's2', prompt: { text: 'hi' } });
  await fake.hooks['tool.execute.before']({ sessionID: 's2', id: 'c', tool: 'bash', input: {} });
  await new Promise((r) => setTimeout(r, 100));
  await stop();
});

test('installer: one file under ~/.config/opencode/plugins, idempotent, removable, picked up by her', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-opencode-'));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    const installer = require('../scripts/install-opencode-plugin');
    assert.equal(installer.status().installed, false);
    const { file } = installer.install();
    assert.equal(file, path.join(dir, 'opencode', 'plugins', 'capri-opencode.ts'));
    assert.ok(fs.readFileSync(file, 'utf8').includes('Capri'));
    assert.equal(installer.status().installed, true);
    assert.equal(installer.status().stale, false);

    const { assistant, resolveAssistant } = require('../src/main/assistants');
    assert.equal(resolveAssistant('auto'), 'opencode');
    assert.equal(assistant('opencode').hooks, installer);
    assert.match(assistant('opencode').help, /opencode\.ai/);

    installer.install(); // again: same file, no copy left behind
    assert.deepEqual(fs.readdirSync(path.join(dir, 'opencode', 'plugins')), ['capri-opencode.ts']);

    installer.uninstall();
    assert.equal(installer.status().installed, false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readdirSync(path.join(dir, 'opencode', 'plugins')).length, 0);
  } finally {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenCode speaks her lines, with its own name and plugin file', async () => {
  const { LINES, linesFor, ASSISTANT_NAMES } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  assert.equal(ASSISTANT_NAMES.opencode, 'OpenCode');
  const strings = (value) => value == null ? [] : typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(strings) : Object.values(value).flatMap(strings);
  for (const lang of Object.keys(LINES)) {
    const text = linesFor(lang, 'opencode');
    assert.doesNotMatch(strings(text).join('\n'), /Claude|settings\.json|\.claude/);
    assert.match(text.welcome.about, /OpenCode/);
    assert.match(text.welcome.connect, /OpenCode/);
  }
});
