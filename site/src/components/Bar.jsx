import { NAV } from '../data.js';

export default function Bar() {
  return (
    <header className="bar">
      <a className="mark" href="#top">
        CAPRI
      </a>
      <nav className="bar__nav">
        {NAV.map(({ href, label }) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
