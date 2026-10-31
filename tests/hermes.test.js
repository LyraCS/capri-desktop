'use strict';
// Hermes Agent speaks Claude Code's hook shape already (its outbound webhooks send
// { hook_event_name, tool_name, tool_input, session_id, cwd, extra }), so the adapter is a
// dictionary — and this is the check that the words land right.

const test = require('node:test');
const assert = require('node:assert/strict');
const { event } = require('../src/main/hermes');

const base = { profile: 'capri', session_id: 'abc123', cwd: '/Users/lyra/capri-desktop', extra: {} };

test('Hermes events come out as the ones her brain reads, in a session of its own', () => {
  const start = event({ ...base, hook_event_name: 'on_session_start' });
  assert.deepEqual(start, { hook_event_name: 'SessionStart', session_id: 'hermes:abc123', cwd: '/Users/lyra/capri-desktop', source: 'start' });

  const prompt = event({ ...base, hook_event_name: 'pre_llm_call', extra: { user_message: 'open youtube' } });
  assert.equal(prompt.hook_event_name, 'UserPromptSubmit');
  assert.equal(prompt.prompt, 'open youtube');
});

test('its tool names and arguments are said the way Claude tools say them', () => {
  const pre = event({ ...base, hook_event_name: 'pre_tool_call', tool_name: 'read_file', tool_input: { path: '/tmp/x.md' } });
  assert.equal(pre.tool_name, 'Read');
  assert.equal(pre.tool_input.file_path, '/tmp/x.md'); // brain.js reads file_path to know what she touched

  assert.equal(event({ ...base, hook_event_name: 'pre_tool_call', tool_name: 'terminal' }).tool_name, 'Bash');
  // one she has no word for keeps its own name rather than disappearing
  assert.equal(event({ ...base, hook_event_name: 'pre_tool_call', tool_name: 'browser_exec' }).tool_name, 'WebFetch');
});

test('a failed tool and a stopped turn are the events she has for them', () => {
  const ok = event({ ...base, hook_event_name: 'post_tool_call', tool_name: 'terminal', extra: { status: 'ok' } });
  assert.equal(ok.hook_event_name, 'PostToolUse');
  const bad = event({ ...base, hook_event_name: 'post_tool_call', tool_name: 'terminal', extra: { error_type: 'Timeout' } });
  assert.equal(bad.hook_event_name, 'PostToolUseFailure');

  // a turn that just finished: said once, by post_llm_call (on_session_end would say it again)
  assert.equal(event({ ...base, hook_event_name: 'post_llm_call', extra: {} }).hook_event_name, 'Stop');
  assert.equal(event({ ...base, hook_event_name: 'on_session_end', extra: { completed: true } }), null);
  assert.equal(event({ ...base, hook_event_name: 'on_session_end', extra: { interrupted: true } }).hook_event_name, 'Interrupt');
  assert.equal(event({ ...base, hook_event_name: 'on_session_end', extra: { failed: true } }).hook_event_name, 'StopFailure');
  assert.equal(event({ ...base, hook_event_name: 'subagent_stop' }).hook_event_name, 'SubagentStop');
});

test("Claude Code's own events and anything else are not ours, and pass through untouched", () => {
  assert.equal(event({ hook_event_name: 'PreToolUse', session_id: 'x' }), undefined);
  assert.equal(event({}), undefined);
  assert.equal(event(null), undefined);
  // one of ours that says nothing to her: the adapter answers it with a Stop of its own (see settle)
  assert.equal(event({ hook_event_name: 'post_api_request', session_id: 'x' }), null);
});
