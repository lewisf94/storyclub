# StoryClub — status & handoff

_A snapshot for picking up in a fresh chat/session. The technical reference is in
[ARCHITECTURE.md](./ARCHITECTURE.md); end-user setup is in [README.md](./README.md);
project conventions are in [CLAUDE.md](./CLAUDE.md)._

## What this is

StoryClub is a **book-club wheel** (static HTML/CSS/vanilla JS + Firebase),
adapted from a film-club app of the same architecture. A group adds books to a
wheel, spins to pick the month's read, sets a read-by deadline, and everyone
marks it read and leaves a sealed half-star rating + review that unseal once the
whole club is in.

## Where things stand

- **Adapted to books.** All user-facing copy, the three themes (Paperback /
  Library / Pulp), the favicon and the metadata source are book-flavoured.
- **Metadata is Open Library** (`js/openlib.js`) — keyless and always on:
  title/author search with covers, year/page-count/subjects, a details popup and
  "more like this". The film-only "where to watch / who can watch / streaming
  services" feature was **removed** (no book equivalent).
- **Imports** come from **Goodreads** CSV (was Letterboxd).
- **Schema names are unchanged** from the film original — books live in a
  `movies` subcollection, the current pick is `currentFilm`, page count is
  `runtime`, the cover id is `posterPath`, finished readers are `watchedBy`.
  They're internal; see the note in [CLAUDE.md](./CLAUDE.md).
- **Firebase config** in `js/firebase.js` still points at the original project.
  For a separate book club, create your own Firebase project and paste its
  config (README steps 1–6). App Check and Web Push are off by default.

## Likely next steps

- Point `js/firebase.js` at a fresh Firebase project so book clubs don't share a
  backend with anything else.
- Regenerate the PWA app icons in `assets/` (currently the original film-reel
  PNGs; the in-page favicon is already a book — `assets/favicon.svg`).
- Skim [ROADMAP.md](./ROADMAP.md): it's inherited from the film app, so some
  items (TMDB, streaming) no longer apply.
