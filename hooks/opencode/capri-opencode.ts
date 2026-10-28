// Capri's OpenCode plugin: what OpenCode is doing, translated into the hook events Capri already
// knows (the ones Claude Code and Codex send her), posted to her local bridge.
//
// Observe only. Nothing here decides anything for OpenCode, nothing blocks a turn, and nothing
// leaves your machine: the events go to 127.0.0.1 and the connection failing is not an error.
//
// Loaded from ~/.config/opencode/plugins/ (installed by `node scripts/install-opencode-plugin.js`).

const PORT = Number(process.env.CAPRI_PORT) || 47823;
const ENDPOINT = `http://127.0.0.1:${PORT}/event`;
const REPLY_MAX = 6000;

// OpenCode's tool names, as Capri knows them (she has verbs for Claude Code's tools)
const TOOLS = {
  bash: 'Bash',
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  patch: 'MultiEdit',
  multiedit: 'MultiEdit',
  grep: 'Grep',
  glob: 'Glob',
  list: 'Glob',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  task: 'Task',
  agent: 'Task',
  skill: 'Skill',
  todowrite: 'TodoWrite',
  question: 'AskUserQuestion',
};

// The same trimming Capri's own hook scripts do: what she uses, no file contents, no tool output.
function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 280 ? value.slice(0, 280) + '…' : value;
  if (Array.isArray(value)) return depth > 2 ? undefined : value.slice(0, 8).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return undefined;
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (['content', 'old_string', 'new_string', 'new_source', 'edits', 'patch'].includes(key)) {
        out[key + '_len'] = typeof inner === 'string' ? inner.length : Array.isArray(inner) ? inner.length : 0;
        continue;
      }
      out[key] = trim(inner, depth + 1);
    }
    return out;
  }
  return value;
}

// OpenCode passes camelCase inputs; Capri reads Claude Code's snake_case ones.
function input(tool, value) {
  if (!value || typeof value !== 'object') return {};
  const out = { ...value };
  if (out.filePath !== undefined && out.file_path === undefined) out.file_path = out.filePath;
  if (out.notebookPath !== undefined && out.notebook_path === undefined) out.notebook_path = out.notebookPath;
  if (out.oldString !== undefined && out.old_string === undefined) out.old_string = out.oldString;
  if (out.newString !== undefined && out.new_string === undefined) out.new_string = out.newString;
  if (tool === 'Skill' && out.skill === undefined) out.skill = value.name;
  if (tool === 'Task' && out.subagent_type === undefined) out.subagent_type = value.agent;
  return out;
}

const sessions = new Map(); // id -> { cwd, title, last }

function post(event) {
  let body;
  try {
    body = JSON.stringify(event);
  } catch {
    return;
  }
  // fire and forget, with a short leash: she may not even be running
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': new TextEncoder().encode(body).length },
    body,
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}

export default {
  id: 'capri',
  async setup(ctx) {
    const cwd = ctx.location?.directory;
    const state = (id) => {
      let s = sessions.get(id);
      if (!s) {
        s = { cwd, title: undefined, last: '' };
        sessions.set(id, s);
      }
      return s;
    };
    const send = (id, event) => {
      const s = state(id);
      post({
        ...event,
        session_id: `opencode:${id}`, // how she tells whose session it is
        cwd: s.cwd,
        ...(s.title ? { session_title: s.title } : {}),
      });
    };

    // you sent something
    await ctx.session.hook('prompt', (event) => {
      const s = state(event.sessionID);
      if (event.prompt?.text) s.last = '';
      send(event.sessionID, { hook_event_name: 'UserPromptSubmit', prompt: event.prompt?.text || '' });
    });

    // a tool is about to run, then how it went
    await ctx.tool.hook('execute.before', (event) => {
      const tool = TOOLS[event.tool] || event.tool;
      send(event.sessionID, {
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: trim(input(tool, event.input)),
        tool_use_id: event.id,
      });
    });

    await ctx.tool.hook('execute.after', (event) => {
      const tool = TOOLS[event.tool] || event.tool;
      if (event.status === 'error') {
        send(event.sessionID, {
          hook_event_name: 'PostToolUseFailure',
          tool_name: tool,
          tool_input: trim(input(tool, event.input)),
          tool_use_id: event.id,
          error: event.error?.message || String(event.error || ''),
          is_interrupt: Boolean(event.error?.interrupted),
        });
        return;
      }
      send(event.sessionID, {
        hook_event_name: 'PostToolUse',
        tool_name: tool,
        tool_input: trim(input(tool, event.input)),
        tool_use_id: event.id,
      });
    });

    // a permission prompt is about to be shown: she points at it
    await ctx.permission.hook('evaluate', (event) => {
      if (event.effect !== 'ask') return;
      send(event.sessionID, {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: [event.action, ...(event.resources || [])].filter(Boolean).join(' ').slice(0, 280),
      });
    });

    // the session's own life: started, answered, interrupted, compacted, gone
    const stop = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          const data = event.data || {};
          const id = data.sessionID;
          if (!id) continue;
          switch (event.type) {
            case 'session.created': {
              const s = state(id);
              s.cwd = data.location?.directory || s.cwd;
              s.title = data.title || s.title;
              if (data.parentID) send(id, { hook_event_name: 'SubagentStart', agent_type: 'task' });
              else send(id, { hook_event_name: 'SessionStart', source: 'startup' });
              break;
            }
            case 'session.text.ended':
              if (typeof data.text === 'string') state(id).last = data.text.slice(0, REPLY_MAX);
              break;
            case 'session.execution.succeeded':
              send(id, {
                hook_event_name: 'Stop',
                last_assistant_message: state(id).last || undefined,
                stop_hook_active: false,
              });
              break;
            case 'session.execution.failed':
              send(id, {
                hook_event_name: 'StopFailure',
                error: data.error?.message || data.message || 'OpenCode stopped on an error',
              });
              break;
            case 'session.execution.interrupted':
              send(id, { hook_event_name: 'Interrupt', reason: data.reason || 'user' });
              break;
            case 'session.compaction.started':
              send(id, { hook_event_name: 'PreCompact', trigger: 'auto' });
              break;
            case 'session.deleted':
              send(id, { hook_event_name: 'SessionEnd', reason: 'other' });
              sessions.delete(id);
              break;
            default:
              break;
          }
        }
      } catch {
        // Capri is gone, or OpenCode is shutting down: nothing to do about it
      }
    })();

    return () => stop.abort();
  },
};
