import { LINKS, SPECS, VERSION } from '../data.js';

export default function Download() {
  return (
    <section id="download" className="band">
      <div className="panel panel--cta">
        <h2 className="band__title">
          <span className="idx">03</span> Put her on your desktop
        </h2>
        <p className="lede">
          Free to download, built for macOS 13 or newer. Nothing is required for her to work: Screen Recording (for
          reading window titles) and Automation (when she drives Terminal or Music) are optional, and asked for only
          the first time she needs them.
        </p>
        <div className="cta">
          <a className="btn" href={LINKS.release}>
            Download Capri {VERSION}
          </a>
          <a className="btn btn--ghost" href={LINKS.macNotes}>
            Install notes
          </a>
        </div>
        <ul className="specs">
          {SPECS.map(([label, value]) => (
            <li key={label}>
              <span>{label}</span> {value}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
