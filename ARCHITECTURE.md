# Architecture

StoryClub is a static front end talking directly to Cloud Firestore — there is no
server of our own. Firestore plus its security rules **are** the backend. Every
browser signs in anonymously so the rules can require authentication.

> **Naming note:** StoryClub was adapted from a film-club app. The Firestore
> schema kept its original names to avoid a risky migration, so below you'll see
> a `movies` subcollection, `currentFilm`, `watchedBy`, `posterPath` (a cover id)
> and `runtime` (a page count). These hold **books** — the film names are internal
> only and never shown to readers. Book metadata comes from **Open Library**
> (`js/openlib.js`), which replaced the old TMDB integration; the film-only
> "where to watch / streaming services" feature was removed.

## Data model (Firestore)

```
groups/{code}                         # code = 5-char share code (Kahoot-style)
  name: string
  createdAt, createdByName
  memberOrder: [memberId, ...]        # turn order = join order
  memberUids: [authUid, ...]          # Firebase anon-auth uids = membership (security rules)
  currentSpinnerIndex: number         # whose turn to spin (index into memberOrder)
  currentFilm: {                      # the film in play this week, or null
    movieId, title, addedByName, spinnerName, pickedAt, deadline
  } | null
  lastSpin: { seed, startedAt, durationMs, segments[], winnerIndex, spinnerName } | null
  vote: {                             # approval-vote round (alt to the spin), or null
    startedBy, startedByName, startedAt, shortlist: [movieId, ...],
    ballots: { memberId: [movieId, ...] }   # most-approved shortlist film wins
  } | null
  adminMemberId, bannedUids[], bannedMemberIds[], streamFilter   # admin/kick, ban, stream toggle
  resetRequest: {                     # unanimous-consent reset, or null
    startedBy, startedByName, startedAt, approvals: [memberId, ...]
  } | null

  members/{memberId}                  # memberId = random id kept in the browser
    name, uid, joinedAt               # uid = Firebase auth uid (for the rules)
    pushTokens: [fcmToken, ...]       # optional: per-device Web Push tokens (deadline reminders)

  movies/{movieId}                    # "movies" docs hold books (kept name)
    title, addedByName, addedByMemberId, addedAt
    status: "wheel" | "current" | "watched"   # "watched" = read
    pickedAt, watchedAt, deadline
    watchedBy: [memberId, ...]        # who confirmed they read the current book
    tmdbId?, author?, year?, posterPath?, runtime?, genres?[]
                                      # Open Library metadata: tmdbId = work key,
                                      # posterPath = cover id, runtime = page count,
                                      # genres = subjects

  ratings/{movieId__memberId}         # one per member per book
    movieId, memberId, uid, name, score (0.5-5), review, updatedAt

  comments/{commentId}                # per-film discussion (revealed with reviews)
    movieId, memberId, uid, name, text, createdAt
```

No login/accounts: identity is a random `memberId` + display name in
`localStorage` (`session.js`). The anonymous-auth `uid` is also recorded on join
(`memberUids` on the group; `uid` on member/rating docs) so the security rules
can lock each club to its own members.

**Portable identity (optional).** Anonymous auth is per-browser, so clearing
storage or switching devices would otherwise lose your club. The "Save your
account" button links an **email** onto the anonymous account via a passwordless
sign-in link — `linkWithCredential` keeps the **same uid** in place. On a new
device, opening the same link signs you in as that account (recovering the uid),
and `joinGroup` reclaims your existing member seat (matching `uid` → `memberId`)
instead of creating a duplicate. Needs the Email-link provider enabled in the
console; nothing breaks if it's never used.

## The weekly round

1. The member at `currentSpinnerIndex` spins (`commitSpin`). The winner becomes
   `currentFilm` (status `current`, `watchedBy: []`); `lastSpin` drives the same
   spin animation in every browser.
2. Each member clicks "I've watched it" (`markWatchedAck` → `arrayUnion` on the
   movie's `watchedBy`) and submits a rating (`saveRating`). Everyone else's
   ratings stay **sealed** in the UI until the round completes.
3. When **every current member is in `watchedBy` AND has a rating**,
   `finalizeRound` runs (an idempotent transaction): the film flips to
   `watched`, `currentFilm` clears, `currentSpinnerIndex` advances. That reveals
   all reviews (the film is now history) and unlocks the next spin.
   - **Single writer:** to avoid every browser racing the same transaction, only
     the **current spinner's** client auto-commits immediately; other clients
     wait `FALLBACK_MS` and step in only if the spinner didn't (e.g. they're
     away). So there's no contention in the common case and no softlock if the
     spinner is gone.
   - The current spinner can also `finalizeRound` early ("wrap up now") if
     someone is away.

The gating logic lives in `app.js` (`roundState`, plus the single-writer
auto-finalize in `render`).

## Group reset (unanimous)

`requestReset` writes `resetRequest` with the proposer pre-approved; `approveReset`
appends approvals; any `cancelReset` (decline/cancel) clears it. Once every member
has approved, `performReset` deletes all `movies` + `ratings` (in chunks of ≤15 so
each batch stays under the security rules' 20-`get()`-per-batch ceiling) and clears
the group's play state (keeping members and the code). The same **single-writer**
pattern as finalize applies — the proposer commits the wipe, others are the
fallback. Enforced client-side — fine for a friendly club, not a hostile-actor
guarantee.

## Live data & rendering

`app.js` opens four `onSnapshot` listeners (group doc, members, movies, ratings)
and re-renders on any change. Rendering is plain `innerHTML` templates + event
listeners; the film card, wheel/films/ratings tabs are rendered in `app.js`,
stats in `stats.js`. Renders are **coalesced** (`scheduleRender`, a `setTimeout(0)`
debounce) so a burst of listener events — the four firing together on load, or a
spin touching the group doc *and* a movie — rebuilds the DOM once, not four times.

**Scaling the reads (future).** The movies and especially the `ratings`
listeners load the whole history, so reads grow with the club's age. For a
large/old club the next step is to keep only the *current round's* ratings on a
live listener and load the archive on demand when the History/Stats tabs open
(or denormalise a small "group state" doc). Deferred for now — it's a real
change to the data flow and wants emulator testing before it touches the live
app; small clubs are fine as-is.

## Themes

Three themes, each a full design system (layout, shapes, type, texture, and the
wheel), chosen per-user via `localStorage` + the `data-theme` attribute:

| id | label | feel |
|----|-------|------|
| `a24` | Paperback | clean editorial Playfair serif, black on white, fine grain |
| `festival` | Library | printed-paper parchment, halftone + grain, double rules |
| `strokes` | Pulp | Win95/GeoCities cobalt desktop, beveled windows, dither + scanlines |

A theme = a CSS `[data-theme="…"]` block in `styles.css` **and** a branch in
`wheelStyle()` in `wheel.js` (palette/ring/hub/pointer/labels). `theme.js` fires
`storyclub:themechange`; `app.js` listens and re-renders so the canvas wheel
restyles live.

## Wheel rendering

`wheel.js` draws on a `<canvas>` sized to `devicePixelRatio` for crispness
(`setupHiDPI`) while drawing in logical coordinates, with `lineJoin: round` so
stroked labels don't spike. The spinner picks the winner up front; `commitSpin`
writes `lastSpin`, and every browser animates the same easing so it lands on that
segment. Sound is WebAudio; the win burst is canvas-confetti.

## Security model

`firestore.rules` locks each club to its own members. All access requires
`request.auth != null` (anonymous sign-in), and beyond that:

- **Membership = `memberUids`.** A club's members, movies and ratings are
  readable/writable only if `request.auth.uid` is in the group's `memberUids`
  list (checked via a `get()` on the group doc).
- **`get` yes, `list` no.** Anyone signed in may *read a single group doc by
  code* (needed to look one up in order to join, and for the live group
  listener) — but listing/enumerating all clubs is denied.
- **Join is constrained.** A non-member may update the group doc *only* to
  append their **own** uid (and their memberId to the rotation) — they can't
  add anyone else or touch any other field. So you can't read or alter a club
  you haven't joined. The rotation (`memberOrder`) is **append-only** on join
  (existing entries preserved, grows by ≤1), so a joiner can't scramble it, and
  a uid in the group's **`bannedUids`** (set by a kick) is refused — so a kicked
  member with a stable/saved uid can't rejoin via a raw API call (a *fresh
  anonymous* uid still could; that needs server-side join). A kicked member's
  **live session** is ejected client-side too: they keep receiving group-doc
  snapshots (single-doc `get` is open) but their subcollection reads now fail, so
  `app.js` watches for its own memberId/uid in `bannedMemberIds`/`bannedUids` and
  returns to the landing screen instead of freezing on a half-loaded club.
- **Own rating/comment only.** A member may create/update only a rating or
  comment carrying their own `uid` **and** whose denormalised `memberId`
  resolves to a member record owned by that uid (`ownsMember`) — so you can't
  author one under another member's memberId/name and impersonate them. A
  rating's doc id is pinned to `movieId__memberId` (one per member per film).
  No client deletes of the group doc.
- **Bounded writes.** The rules cap field sizes — rating `score` is a number
  0.5–5, review ≤2000 chars, comment text ≤2000, member/group name ≤200 — so a
  member can't write junk scores or stuff oversized documents.

**Client-trusted by default** (the zero-backend mode): the turn-rotation,
finalize and unanimous-reset *invariants* are enforced in the client, and a
member could over-delete their own club's movies/ratings. That's fine for a
friendly club, not a hostile-actor guarantee.

**Rollout:** the uid-recording client (this code) must ship **before** the new
rules are published, so existing members record a uid (`memberUids`) on their
next visit; otherwise they'd be locked out until they re-join. The rules are in
`firestore.rules` but do **not** auto-deploy — test them in the Firebase
Emulator, then paste into the console (Firestore → Rules → Publish).

## Server-authoritative mode (optional)

For hard guarantees instead of client trust, deploy the **Cloud Functions** in
`functions/` and set `useFunctions = true` in `js/firebase.js`. Then every write
that touches shared club state — spin, set deadline, mark watched, finalize,
and request/approve/cancel reset — routes through callable functions that run
with the Admin SDK and enforce the invariants server-side:

- the turn passes only when **every** member has watched **and** rated (the
  spinner may force an early wrap-up);
- a reset wipes only on **unanimous** approval, performed atomically inside
  `approveReset` when the last approval lands (so no client race — this
  supersedes the client single-writer);
- you can mark only **yourself** watched; only the current spinner can spin,
  only when no film is in play, and only onto a real wheel film.

This is **off by default** (the Functions SDK isn't even fetched), so the static
zero-backend deploy is unaffected until you opt in. It needs the Blaze plan and
a deploy step (the static front end itself stays no-build). When on, publish the
**hardened** rules in `functions/firestore.rules`, which forbid clients from
writing those fields directly — the functions become the only path. Full
walkthrough: `functions/README.md`.

**Not yet covered (incompatibility).** The approval **vote** (`startVote` /
`submitBallot` / `cancelVote` / `commitVoteWinner`), **vote-to-remove**
(`voteRemoveMovie`) and the club **service override** (`setMovieServices`) were
added after the functions and have **no callable** — they write Firestore
directly and don't branch on `useFunctions`. Since the hardened rules forbid
exactly those writes (group `vote`/`currentFilm` are function-only; movie updates
are `if false`), enabling server-authoritative mode **silently breaks** those
three features. They stay correct in the default client-trusted mode. Closing the
gap means adding matching callables (and relaxing the hardened rules for the
low-stakes poll/removeVotes/serviceOverride writes) — tracked in ROADMAP.

## Web Push reminders (optional)

Deadline nudges over Firebase Cloud Messaging. **Off by default** — the
Messaging SDK is never fetched and no permission is asked until a Web Push
**VAPID key** is set in `js/firebase.js` (`messagingVapidKey`).

- **Opt-in (client).** From the Account modal a member taps *Turn on
  reminders*; `js/push.js` (`enablePush`) registers `firebase-messaging-sw.js`,
  requests notification permission, fetches this device's FCM token and
  `arrayUnion`s it onto their member doc (`pushTokens`). Tokens are per-device,
  so a member may have several.
- **Send (server).** The scheduled Cloud Function `sendDeadlineReminders`
  (`functions/`, runs daily) scans clubs with a film in play whose deadline is
  within 48h, and pushes a data message to the `pushTokens` of members who
  haven't marked it watched. Dead tokens (per the FCM response) are pruned.
- **Two service workers.** FCM needs its own worker
  (`firebase-messaging-sw.js`, compat SDK, shows background notifications),
  separate from the app-shell worker (`sw.js`). The app handles foreground
  messages itself via `onForegroundMessage` in `firebase.js`.

Needs the Blaze plan (scheduled functions) and the VAPID key; nothing breaks if
it's never turned on. Setup: README step 8.
