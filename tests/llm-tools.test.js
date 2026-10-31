'use strict';
// Her tool calling at the model layer: the two provider shapes, streamed calls put back together,
// and a server that refuses tools answered again without them.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const llm = require('../src/main/llm');
const ollama = require('../src/main/ollama');

// A fake server for one test: handler(req, body, res).
async function serve(t, handler) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* not JSON: the handler decides */ }
      handler(req, body, res);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const sse = (res, chunks) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of chunks) res.write(`data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
};

const delta = (d) => ({ choices: [{ delta: d }] });
const TOOL = [{ type: 'function', function: { name: 'play_music', description: 'play', parameters: { type: 'object', properties: {} } } }];

test('OpenAI-compatible: streamed tool calls are put back together with the text', async (t) => {
  const url = await serve(t, (_req, _body, res) => sse(res, [
    delta({ role: 'assistant', content: 'Sure, ' }),
    delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'play_music', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"song":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '"Daft Punk"}' } }] }),
  ]));

  let streamed = '';
  const out = await llm.chat('custom', { customUrl: url, apiKeys: {} },
    { model: 'm', messages: [{ role: 'user', content: 'play daft punk' }], tools: TOOL },
    (piece) => { streamed += piece; }, new AbortController().signal);

  assert.equal(out.text, 'Sure, ');
  assert.equal(streamed, 'Sure, ');
  assert.deepEqual(out.calls, [{ id: 'call_1', name: 'play_music', arguments: { song: 'Daft Punk' } }]);
  assert.equal(out.noTools, undefined);
});

test('a server that refuses tools is asked again without them', async (t) => {
  const url = await serve(t, (req, body, res) => {
    if (body?.tools) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'tools are not supported' } }));
      return;
    }
    sse(res, [delta({ content: 'hi them' })]);
  });

  const out = await llm.chat('custom', { customUrl: url, apiKeys: {} },
    { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: TOOL },
    () => {}, new AbortController().signal);

  assert.equal(out.text, 'hi them');
  assert.equal(out.noTools, true);
  assert.deepEqual(out.calls, []);
});

test('Ollama: its whole tool calls (arguments as an object) come back the same way', async (t) => {
  let seen = null; // the conversation it was sent, tool results and all
  const url = await serve(t, (req, body, res) => {
    assert.equal(req.url, '/api/chat');
    seen = body.messages;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(`${JSON.stringify({ message: { content: 'ok' }, done: false })}\n`);
    res.write(`${JSON.stringify({ message: { tool_calls: [{ function: { name: 'control_music', arguments: { action: 'pause' } } }] }, done: true })}\n`);
    res.end();
  });
  process.env.OLLAMA_HOST = url;
  t.after(() => { delete process.env.OLLAMA_HOST; });

  const messages = [
    { role: 'user', content: 'pause' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'control_music', arguments: '{"action":"pause"}' } }] },
    { role: 'tool', tool_call_id: 'call_0', content: '"done"' },
  ];
  const out = await ollama.chat({ model: 'llama3.2', messages, tools: TOOL }, () => {}, new AbortController().signal);

  assert.equal(out.text, 'ok');
  assert.deepEqual(out.calls, [{ id: 'call_0', name: 'control_music', arguments: { action: 'pause' } }]);
  // its result names the tool for Ollama, and no longer carries OpenAI's id
  assert.deepEqual(seen.at(-1), { role: 'tool', content: '"done"', tool_name: 'control_music' });
});

test('who can take tools: anything but Claude Code, and a local model only if it says so', () => {
  assert.equal(llm.supportsTools('deepseek'), true);
  assert.equal(llm.supportsTools('ollama'), true);
  assert.equal(llm.supportsTools('custom'), true);
  assert.equal(llm.supportsTools('claude'), false);
});

test('Ollama: a model without the tools capability is not handed any', async (t) => {
  const url = await serve(t, (req, _body, res) => {
    if (req.url === '/api/show') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ capabilities: ['completion', 'vision'] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  process.env.OLLAMA_HOST = url;
  t.after(() => { delete process.env.OLLAMA_HOST; });

  assert.equal(await ollama.canTools('llama3.2'), false);
});
