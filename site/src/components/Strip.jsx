import intro from '../img/intro.png';

export default function Strip() {
  return (
    <section className="band band--strip">
      <figure className="strip">
        <img
          src={intro}
          width="1356"
          height="178"
          loading="lazy"
          alt="Capri's intro, frame by frame: hands on the screen edges, her face hitting the glass, the wave, then letting go."
        />
        <figcaption className="meta">Her intro, frame by frame. She comes in from outside the screen.</figcaption>
      </figure>
    </section>
  );
}
