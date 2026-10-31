import { CARDS } from '../data.js';

export default function Does() {
  return (
    <section id="does" className="band">
      <h2 className="band__title">
        <span className="idx">01</span> What she does
      </h2>
      <div className="cards">
        {CARDS.map(({ tag, img, alt, title, body }) => (
          <article key={tag} className="card">
            <div className="card__frame">
              <img src={img} loading="lazy" alt={alt} />
            </div>
            <span className="tag">{tag}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
