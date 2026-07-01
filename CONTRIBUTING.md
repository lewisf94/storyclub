# Contributing / development notes

## Setup

1. Create a Firebase project and put its web config in `js/firebase.js`.
2. In the Firebase console: create Firestore, publish `firestore.rules`, and
   enable **Anonymous** sign-in (README.md has the click-by-click).
3. Serve over HTTP: `python3 -m http.server 8000` → http://localhost:8000.

Test multiplayer by opening a second browser/profile and joining the same code.

## Ground rules

- No build step, no framework, no bundler — plain HTML/CSS/ES modules.
- Import Firebase only from `js/firebase.js`; extend its import **and** export
  list when you need a new SDK function.
- No emojis in the UI.
- Escape any user-provided string with `esc()` before inserting into `innerHTML`.
- Keep the three themes in sync: every theme is a CSS `[data-theme]` block **and**
  a `wheelStyle()` branch. Themes are per-user (localStorage), never in Firestore.

## Before you commit

- Parse-check the modules:
  `for f in js/*.js; do cp "$f" /tmp/c.mjs && node --check /tmp/c.mjs || echo "FAIL $f"; done`
- Check `styles.css` braces balance and that every `var(--x)` is defined.
- Click through: create/join, add books, spin, mark read, rate, reveal, stats,
  and a group reset — across all three themes, desktop **and** mobile.

## Deploy

Push to `main`; GitHub Pages redeploys to https://lewisf94.github.io/storyclub/.
