# site/

The promo page for Capri. Static marketing page, built with React + Vite and kept in its own
package so the app itself stays bundler-free (`package.json` at the repo root is untouched, and
`site/` is not in electron-builder's `files` list, so it never ships inside the app).

```sh
cd site
npm install
npm run dev      # local, with reload
npm run build    # writes site/dist/ — plain files you can serve from anywhere
npm run preview  # serve that build
```

`vite.config.js` sets `base: './'`, so one build works both opened from disk and served from a
GitHub Pages project path (`/capri-desktop/`) without a rebuild.

## Where things live

- `src/data.js` — version, links, card copy, nav, agent names, specs. **Change text here.**
- `src/components/` — one component per section: `Bar`, `Hero`, `Does`, `Agents`, `Strip`,
  `Download`, `Credits`, `Footer`. No state, no fetching.
- `src/styles.css` — her palette and the flat, hard-edged look, copied from the app's
  `src/renderer/styles/capri.css`. Design tokens are CSS custom properties at the top; components
  use those, never raw hex.
- `src/img/`, `src/fonts/` — imported from JS/CSS so Vite hashes them.

The version is written in `src/data.js` (`VERSION`) and shown twice on the page. Bump it with the app.
