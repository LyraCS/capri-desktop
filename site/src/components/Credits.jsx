import { LINKS } from '../data.js';

// Two audiences, two panels: whose work this is, and what wrote it.
export default function Credits() {
  return (
    <section id="credits" className="band">
      <h2 className="band__title">
        <span className="idx">04</span> Credits
      </h2>
      <div className="credits">
        <article className="panel panel--credit">
          <span className="tag tag--violet">ORIGINAL</span>
          <h3>Capri is mochiiwuff's</h3>
          <p>
            The Windows app, her sprite and the shader that draws her, the cut-ins, the intro, the lines in five
            languages — all of it was built by <a href={LINKS.author}>mochiiwuff</a>. This macOS port and this page are
            a fork of <a href={LINKS.upstream}>mochiiwuff/capri-desktop</a>. Without his work there is nothing here to
            download.
          </p>
        </article>

        <article className="panel panel--credit">
          <span className="tag">AI</span>
          <h3>The port is vibecoded</h3>
          <p>
            The macOS fork is <a href={LINKS.fork}>LyraCS</a>'s, and it was written with generative AI: coding agents
            wrote most of the port and its features, directed, tested and corrected by hand. That is worth knowing
            before you run it — expect rough edges, and keep a backup of anything you care about.
          </p>
        </article>
      </div>
    </section>
  );
}
