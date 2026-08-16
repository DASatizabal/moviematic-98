# MovieMatic 98

A movie night picker for family movie night, dressed up as a Windows 98 desktop
application. Pick a title from the list or hit **Pick for me** and let the slot
machine land on one for you. Watched titles are remembered in your browser.

**Live:** https://dasatizabal.github.io/moviematic-98/

## Features

- Slot-machine spin on the green-phosphor CRT panel (winner is chosen before the
  animation starts, so the spin is purely decorative)
- Checkbox per title to track what the family has already seen, saved to
  `localStorage`
- "Skip titles already watched" filters the random pool, and falls back to the
  full list once everything is watched so the button never dead-ends
- Keyboard accessible: rows are focusable and respond to Enter and Space
- Respects `prefers-reduced-motion` (skips the spin and the blinking caret)
- Responsive down to a 360px phone screen

## Editing the movie list

All movie data lives in `movies.json` — no code changes needed. Each entry is:

```json
{
  "title": "Galaxy Quest",
  "year": 1999,
  "rating": "PG",
  "runtime": 102,
  "hook": "Washed-up sci-fi actors get drafted into a real space war."
}
```

`runtime` is in minutes. `hook` is the one-line description shown on the CRT.

## Running locally

The page fetches `movies.json`, so it needs to be served over HTTP — opening
`index.html` straight from the filesystem will trip the browser's CORS rules and
show "Could not load movies.json".

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure (title bar, menu bar, list, CRT, status bar) |
| `styles.css` | Windows 98 chrome — bevels, gradients, CRT scanlines |
| `app.js` | Loading, selection, spin animation, watched-state persistence |
| `movies.json` | The movie list |

No build step, no frameworks, no dependencies, no CDN links.

## Deploying

GitHub Pages serves this straight from the repository root:
**Settings → Pages → Deploy from branch → `main` → `/ (root)`**
