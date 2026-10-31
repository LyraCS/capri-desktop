'use strict';

// Hermes Agent, translated into the hook events she already understands.
//
// Hermes' `hooks.outbound` (one entry in its config.yaml, written by scripts/install-hermes-hooks.js)
// POSTs one JSON body per lifecycle event to her bridge:
//   { hook_event_name, profile, tool_name, tool_input, session_id, cwd, extra }
// That is Claude Code's hook shape already — same field names, same idea — so the adapter is a
// dictionary: Hermes' vocabulary in, the words brain.js knows out. Nothing here answers Hermes, and
// nothing leaves the machine: the events go to 127.0.0.1 and a failed POST is not an error.

const EVENTS = {
  on_session_start: 'SessionStart',
  on_session_reset: 'SessionEnd',
  pre_llm_call: 'UserPromptSubmit',
  pre_tool_call: 'PreToolUse',
  post_tool_call: 'PostToolUse',
  // once per turn, after the tool loop: the turn is over, which is what Stop means to her
  post_llm_call: 'Stop',
  on_session_end: 'Stop',
  subagent_stop: 'SubagentStop',
};

// Hermes' tool names, as she calls them (her verbs are Claude Code's)
const TOOLS = {
  terminal: 'Bash',
  process_manage: 'Bash',
  execute_code: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  patch: 'Edit',
  search_files: 'Grep',
  web_search: 'WebSearch',
  web_extract: 'WebFetch',
  browser_exec: 'WebFetch',
  delegate_task: 'Task',
  skill_view: 'Skill',
  skill_manage: 'Skill',
  todo_list: 'TodoWrite',
  memory: 'Write',
  session_search: 'Grep',
  cronjob_manage: 'TodoWrite',
  vision_analyze: 'Read',
  clarify: 'AskUserQuestion',
};

// Hermes hands a tool `path`, `pattern`…; Claude's tools say `file_path`, `query`…, which is what she
// reads to show you the file it touched.
function input(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = { ...raw };
  if (out.path !== undefined && out.file_path === undefined) out.file_path = String(out.path);
  if (out.pattern !== undefined && out.query === undefined) out.query = String(out.pattern);
  return out;
}

// Hermes never says when a turn is over — `post_llm_call` doesn't reach a desktop session, and a
// one-shot turn doesn't send it either — so the chip stayed up long after the answer. It does say
// when each API call came back, though: one that no tool follows means the answer is written, and
// the adapter says Stop itself a moment later.
const SETTLE_MS = 3000;
const settling = new Map(); // session_id -> timer

function settle(sessionId, publish) {
  clearTimeout(settling.get(sessionId));
  settling.set(sessionId, setTimeout(() => {
    settling.delete(sessionId);
    publish({ hook_event_name: 'Stop', session_id: sessionId, cwd: '' });
  }, SETTLE_MS));
  if (settling.get(sessionId).unref) settling.get(sessionId).unref();
}

function cancel(sessionId) {
  clearTimeout(settling.get(sessionId));
  settling.delete(sessionId);
}

// The event as brain.js reads it, or null when it's one of ours that says nothing to her (an API
// call coming back), or undefined when the payload isn't Hermes' at all (Claude Code's own hooks
// reach her through the same bridge, untouched).
function event(raw, publish = () => {}) {
  const kind = raw?.hook_event_name;
  const session = `hermes:${String(raw?.session_id || 'default')}`;
  if (kind === 'post_api_request') {
    settle(session, publish);
    return null;
  }
  const name = EVENTS[kind];
  if (!name) return undefined;
  // anything else from that session means the turn is still moving
  if (kind === 'pre_tool_call' || kind === 'pre_llm_call' || kind === 'on_session_start' || kind === 'on_session_end') cancel(session);
  const extra = raw.extra && typeof raw.extra === 'object' ? raw.extra : {};
  const evt = {
    hook_event_name: name,
    // whose session it is: the prefix is how brain.js tells them apart, and what her jealousy reads
    session_id: session,
    cwd: raw.cwd || '',
  };
  if (name === 'SessionStart') evt.source = 'start';
  if (name === 'UserPromptSubmit') evt.prompt = String(extra.user_message || '');
  if (raw.tool_name) {
    evt.tool_name = TOOLS[raw.tool_name] || raw.tool_name;
    evt.tool_input = input(raw.tool_input);
  }
  // one event, two endings: what she says about a tool that failed, and about a turn you stopped
  if (name === 'PostToolUse' && (extra.error_type || extra.status === 'error')) evt.hook_event_name = 'PostToolUseFailure';
  if (name === 'Stop') {
    if (extra.interrupted) evt.hook_event_name = 'Interrupt';
    else if (extra.failed) evt.hook_event_name = 'StopFailure';
    // a finished turn is already said by post_llm_call: her tally would count it twice
    else if (raw.hook_event_name === 'on_session_end') return null;
  }
  return evt;
}

module.exports = { event, EVENTS, TOOLS };
