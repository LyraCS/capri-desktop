import { Fragment } from 'react';
import { AGENTS } from '../data.js';

// the real hook names brain.js answers to, not marketing names
const HOOKS = [
  ['SessionStart', 'she grabs your screen and hauls herself up onto it'],
  ['PreToolUse', <>ticker: <code>EDITS gigs.ts</code>, <code>RUNS npm test</code></>],
  ['Notification', 'she teleports to your mouse and points at the window that wants you'],
  ['Stop', "victory, then the summary and the agent's last sentence"],
];

export default function Agents() {
  return (
    <section id="agents" className="band">
      <h2 className="band__title">
        <span className="idx">02</span> Who she watches
      </h2>
      <ul className="chips">
        {AGENTS.map((name) => (
          <li key={name} className="chip">
            {name}
          </li>
        ))}
      </ul>
      <p className="lede lede--narrow">
        Every adapter observes and nothing else. It never blocks a turn, never decides anything for the agent, and a
        failed event is not an error. Native events are translated into Claude Code's hook vocabulary — which is all
        she ever sees.
      </p>

      <div className="panel">
        <div className="panel__head">
          <span className="tag tag--violet">HOOK → HER</span>
        </div>
        <dl className="hooks">
          {HOOKS.map(([term, detail]) => (
            <Fragment key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </section>
  );
}
