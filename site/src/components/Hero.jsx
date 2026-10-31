import { LINKS, VERSION } from '../data.js';
import cutout from '../img/capri-cutout.png';

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero__copy">
        <p className="eyebrow">PROJECT CAPRICORN · DESKTOP CONSTRUCT · macOS</p>
        <h1>
          She lives on your desktop and tells you what your{' '}
          {/* her glitch: two colour copies, hard on, hard off, no easing */}
          <span className="glitch" data-t="coding AI">
            coding AI
          </span>{' '}
          is doing.
        </h1>
        <p className="lede">
          A ticker over her head says what is running. She teleports next to your mouse when a permission is
          waiting, gets knocked back when a command fails, and loses it when the job is done — then reads you the
          summary.
        </p>
        <div className="cta">
          <a className="btn" href={LINKS.release}>
            Download for macOS
          </a>
          <a className="btn btn--ghost" href={LINKS.readme}>
            Read the README
          </a>
        </div>
        <p className="meta">{VERSION} · Apple Silicon · menu bar resident · ⌘⌃C tucks her away</p>
      </div>
      <figure className="hero__fig">
        <img
          src={cutout}
          width="220"
          height="420"
          alt="Capri: a tall construct with a shard-cut crimson mane, a black body, green accents, both hands open."
        />
      </figure>
    </section>
  );
}
