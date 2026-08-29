# MovieMatic 98

A movie night picker for family movie night, dressed up as a Windows 98 desktop
application. Pick a title from the list or hit **Pick for me** and let the slot
machine land on one for you. Watched titles, custom titles, custom snacks, and
your settings are all remembered in your browser.

**Live:** https://dasatizabal.github.io/moviematic-98/

## Features

### Picking
- Slot-machine spin on the phosphor CRT panel (winner is chosen before the
  animation starts, so the spin is purely decorative)
- **Double feature** picks two different titles and totals the runtime for you
- **Veto** knocks a title out of the pool for tonight only — it comes back on
  reload, because grudges should not be persistent
- Checkbox per title to track what the family has already seen, saved to
  `localStorage`
- "Skip titles already watched" falls back to the full list once everything is
  watched, so the button never dead-ends

### Snacks
- **Snack attack** rolls a snack pairing from `snacks.json` with a prep time and
  a serving note of dubious usefulness
- **Snacks › Open The Pantry** lists everything available and lets you delete
  your own additions

### Adding your own
- **File › Add Title** adds a movie (title, year, rating, runtime, hook) that is
  merged into the list and marked with a ★
- **File › Add Snack** does the same for the pantry
- **File › Export Collection** downloads your custom titles, custom snacks, and
  watched marks as JSON; **Import Collection** merges one back in, skipping
  duplicates

### View
- Four themes: Teal Desktop, Amber Monitor, Y2K Bubblegum, Midnight Cyan
- Scanlines toggle
- Sound effects toggle — square-wave blips synthesized with WebAudio, so there
  are still no asset files. Off by default.
- **Filters** limits the pool by rating and maximum runtime, for when there is
  a real bedtime

### Fun
- The title bar buttons work: minimize collapses the window, maximize widens it,
  and close throws a period-appropriate blue screen
- **File › Shut Down** gives you the orange "it's now safe" screen
- **Help › Excuse Generator** produces a reason movie night is not happening
- **Help › About** reports how many arguments you have avoided

### Everything else
- Keyboard accessible: rows are focusable, arrow keys move through the list,
  dialogs trap focus and close on Escape
- Shortcuts: `P`/`Space` pick, `D` double feature, `S` snack, `W` watched,
  `V` veto, `Esc` close
- Respects `prefers-reduced-motion` (skips the spin and the blinking caret)
- Responsive down to a 360px phone screen

## Editing the lists

Movie data lives in `movies.json` and snack data in `snacks.json` — no code
changes needed. A movie entry is:

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
`rating` should be one of `G`, `PG`, `PG-13`, `R`, `NR` so the rating filter can
see it.

A snack entry is:

```json
{
  "name": "Pizza Rolls",
  "prep": "15 min",
  "note": "Molten for the first eight minutes. Respect the cooldown."
}
```

Anything added through the UI lives in `localStorage` instead, so the JSON files
stay the shared baseline and each browser keeps its own additions.

## Running locally

The page fetches `movies.json` and `snacks.json`, so it needs to be served over
HTTP — opening `index.html` straight from the filesystem will trip the browser's
CORS rules and show "Could not load movies.json".

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure (window chrome, menus, list, CRT, dialogs) |
| `styles.css` | Windows 98 chrome — bevels, gradients, scanlines, themes |
| `app.js` | Loading, picking, menus, dialogs, persistence, sound |
| `movies.json` | The baseline movie list |
| `snacks.json` | The baseline snack pantry |

No build step, no frameworks, no dependencies, no CDN links.

## Storage keys

| Key | Holds |
| --- | --- |
| `moviematic98:watched:v1` | Watched titles |
| `moviematic98:customMovies:v1` | Titles added through the UI |
| `moviematic98:customSnacks:v1` | Snacks added through the UI |
| `moviematic98:settings:v1` | Theme, scanlines, sound, filters |

Vetoes are deliberately not stored — they last for the session only.

## Deploying

GitHub Pages serves this straight from the repository root:
**Settings → Pages → Deploy from branch → `main` → `/ (root)`**
