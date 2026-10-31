import { LINKS } from '../data.js';

export default function Footer() {
  return (
    <footer className="foot">
      <p>
        Capri is a fan project: a construct from <em>Cyberpunk: Edgerunners</em>. Not affiliated with or endorsed by CD
        PROJEKT RED or Studio Trigger.
      </p>
      <p>
        Original Capri, and everything that makes her look like her, is <a href={LINKS.upstream}>mochiiwuff</a>'s. The
        macOS fork is <a href={LINKS.fork}>LyraCS</a>'s and was built with generative AI — see{' '}
        <a href="#credits">credits</a>.
      </p>
      <p>
        Source under the <a href={LINKS.license}>PolyForm Noncommercial License</a>. Her images come from the show and
        are not covered by it.
      </p>
    </footer>
  );
}
