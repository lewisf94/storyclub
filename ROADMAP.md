# StoryClub — improvement roadmap

> **Inherited backlog.** StoryClub was adapted from a film-club app and this
> roadmap came with it. Items about **TMDB, "where to watch" and streaming
> services no longer apply** — that feature was removed and book metadata now
> comes from Open Library. Read the rest with movie→book / watch→read in mind.

Backlog from the architecture / security / performance review (deep research, 2026-06).
**Target context:** PUBLIC app that could scale; **each club must be locked to its own
members.** Checked = done.

Items tagged **[console]** need Lewis to act in the Firebase console / CLI — I can't reach
your Firebase project from here. I write the code; you deploy.

---

## Feature requests — queue (2026-06, Lewis)

Working through these; **checked = shipped**. Pure front-end unless noted.

### Picking the film
- [x] **Spin only what everyone can stream** — toggle so the wheel/spin excludes films not on every member's services
- [x] **Approval vote mode** — alternative to the spin: draws a random shortlist (so a big wheel stays votable), everyone approves the films they'd watch, most-approved wins.
- [x] **Vote a film off the wheel** — anyone can flag a wheel film for removal; once **every member except the one who added it** has voted to remove, it's dropped. Same unanimous-consent pattern as the group reset; votes stored on the movie doc.

### Import
- [x] **Import a Letterboxd watchlist** — upload the exported watchlist CSV, pick films with checkboxes, add to the wheel (enriched via TMDB by title+year).

### Social / engagement
- [x] **Discussion thread per film** — comments on each watched film, revealed with the reviews *(new `comments` subcollection + rules — republish rules)*
- [x] **Activity feed** — recent "X added / rated …"
- [x] **Taste compatibility** — who agrees / clashes most, from rating correlations

### Reminders
- [x] **Add-to-calendar (.ics)** for the watch-by deadline
- [~] **Web push deadline nudges** — *scaffolded; needs a VAPID key + deploy.* Opt-in from
  the Account modal (`js/push.js` stores per-device FCM tokens on the member doc); a daily
  scheduled Cloud Function (`sendDeadlineReminders`) pushes a nudge to anyone who hasn't
  watched yet as the deadline nears, pruning dead tokens. OFF by default (blank
  `messagingVapidKey` in `js/firebase.js` — no SDK fetched, no permission prompt).
  **[console: generate a Web Push VAPID key; Blaze + deploy `functions/`]** — README step 8.

### Richer film info (details popup)
- [x] **Trailer + streaming inline** — "Watch trailer" (TMDB videos) + where-to-watch in the popup
- [x] **TMDB recommendations** — "if you liked last week's pick…" on the Films tab

### Stats / wrap-up
- [x] **Season recap ("StoryClub Wrapped")** — end-of-cycle summary popup
- [x] **Per-film rating breakdown** — half-star histogram on each watched card

### Polish
- [x] **Spoiler tags** in reviews (`||spoiler||`, click-to-reveal)
- [x] **Dark mode** — a light/dark toggle (`[data-mode]`) that applies to every theme
- [x] **"Only spin films everyone can stream" toggle** restyled as a themed pill (tokens only, fits all three themes + dark mode) instead of a bare browser checkbox.

---

## Security hardening (2026-06 review)

From a full review of the rules + client. **Checked = code shipped** (rules still
need **publishing** in the console). **[console]** = your action, no code.

- [x] **SH-2. Enforce kicks/bans in the rules.** `kickMember` records `bannedUids`,
  but `amJoining` never checked them — a kicked member could re-append their uid via a
  direct API call. The join rule now denies any uid in `bannedUids` (both `firestore.rules`
  and `functions/firestore.rules`). Still soft against a *fresh* anonymous uid (no stable
  identity) — that needs server-side join, but a saved/known uid is now blocked.
- [x] **SH-4. Append-only `memberOrder` on join.** `amJoining` constrained `memberUids`
  tightly but let a joiner rewrite `memberOrder` to anything (scramble/wipe the turn order).
  The rule now requires the new `memberOrder` to keep every existing entry and grow by at
  most one.
- [x] **SH-6. Size caps in the rules.** Added length/range validation so a member can't
  stuff oversized docs: rating `score` must be a number 0.5–5, review ≤2000 chars, comment
  text ≤2000, member/group name ≤200. Plus: the hardened rules were **missing a `comments`
  match entirely** (comments would be denied in server-authoritative mode) — added.
- [x] **SH-8. Pin rating/comment author to the caller.** Ratings and comments only checked
  that the doc's `uid` was the caller's — not its denormalised `memberId`/`name`. A member
  could therefore author a rating or comment under **another member's** memberId/name and
  impersonate them in the revealed reviews/comments (and skew the per-member stats). New
  `ownsMember(code)` rule helper requires the doc's `memberId` to resolve to a member record
  whose `uid` is the caller's; ratings additionally pin the **doc id** to `movieId__memberId`
  (one rating per member per film, no stuffing under arbitrary ids). Both rules files.
  *Residual:* a member can still create extra member docs under their own uid (sybil) — that
  needs server-side join (same gap as SH-3); this closes the easy impersonation path.
- [ ] **SH-1. [console] Turn on App Check (reCAPTCHA v3).** Biggest single lever: without it
  the public API key + anonymous auth let anyone script Firestore directly, bypassing the
  site (code brute-forcing, abuse, cost). Scaffolded already (P0 #5) — register the site,
  paste the key in `js/firebase.js`, run **monitor → enforce**.
- [ ] **SH-3. Group-doc metadata leak via guessable 5-char code.** `get` is allowed to any
  signed-in user (needed to join), so a guessed code leaks club name + the denormalised
  display names + current film title (subcollections stay private). Mitigate with App Check
  (SH-1), longer codes, or not denormalising names onto the group doc. *Deferred — changing
  code length breaks existing clubs; revisit if it matters.*
- [ ] **SH-5. [console] Anonymous-account auto-cleanup** (dup of P0 #4) — deletes anon
  accounts >30 days so they stop counting toward quota/billing.
- [ ] **SH-7. TMDB v3 key is embedded in the client** — abusable against your key's quota;
  v3 keys can't be domain-locked. Standard for client TMDB apps; proxy via a Function only
  if it's ever abused. Low. (Plus P0 #6: optional HTTP-referrer restriction on the API key.)
- [ ] **SH-9. Vote feature isn't server-authoritative (latent break).** `startVote`,
  `submitBallot`, `cancelVote`, `commitVoteWinner`, `voteRemoveMovie` and `setMovieServices`
  write Firestore directly and don't branch on `useFunctions` — but the hardened rules forbid
  exactly those writes. So enabling server-authoritative mode **silently breaks voting,
  vote-to-remove, and the where-to-watch override**. Fix: add callables for `commitVoteWinner`
  (it sets `currentFilm` — must stay function-gated) and relax the hardened rules for the
  low-stakes poll/`removeVotes`/`serviceOverride` writes. Documented in `functions/README.md`
  + `ARCHITECTURE.md`; no impact in the default client-trusted mode.

> **Publish step:** SH-2/4/6/8 are in the rules files but **don't auto-deploy**. Test in the
> Firebase Emulator, then paste `firestore.rules` (or `functions/firestore.rules` in
> server-authoritative mode) into Build → Firestore → Rules → Publish.

---

## P0 — Security (critical)

- [x] **1. Record the Firebase auth `uid` as the real identity** (foundation for member-locked rules)
  - store `memberUids: [uid]` on the group doc, `uid` on each member doc, `uid` on each rating
  - files: `js/session.js` (add `getUid`), `js/groups.js`, `js/ratings.js`
  - additive & safe under current rules; lets existing members record a uid on their next visit
- [x] **2. Rewrite `firestore.rules` to member-scoped access** — *written; publish pending (see #3)*
  - `get` allowed, **`list` denied** (no enumerating every club)
  - read/write a club only if `request.auth.uid in group.memberUids`
  - members can only write their **own** rating; can't delete others' data; can't hijack arbitrary clubs
  - constrain the "join" path (you may add only your own uid)
  - `performReset` now chunks deletes (≤15/batch) to stay under the rules' 20 get()/batch ceiling
  - **[console]** publish the rules — **test in the Firebase Emulator first**
- [~] **3. Safe rollout** — *client shipped (steps 1 & the rules file are on `main`); publishing the
  rules is your console step.* Order: the uid-recording client is already live, so now publish
  `firestore.rules` in the console and have everyone re-join once. Locked-out members just re-join.
- [ ] **4. [console]** Turn on **anonymous-account auto-cleanup** (deletes anon accounts >30 days; stops
  them counting toward quota/billing).
- [x] **5. Add Firebase App Check (reCAPTCHA v3)** — *scaffolded; activation pending console*
  - off by default (blank `recaptchaV3SiteKey` in `js/firebase.js`), SDK lazy-loaded only when set,
    so zero cost until enabled; README step 7 has the setup
  - **[console + site key]** register the site, paste the key, run in **monitor** then **enforce**
- [ ] 6. (optional) Restrict the Web API key by HTTP referrer in Google Cloud (soft layer, not a boundary).

## P1 — Correctness & reliability

- [x] **7. Single-writer finalize/reset** — the round owner (spinner / reset proposer) commits
  immediately; other clients wait `FALLBACK_MS` and only step in if the owner didn't. Kills the
  N-client transaction race (contention → `ABORTED`) with no softlock. (`js/app.js`.) A Cloud
  Function (#8) would make it authoritative.
- [x] **8. Move privileged invariants server-side (Cloud Functions)** — *built; deploy pending* —
  callable functions in `functions/` own every shared-state write (spin, set deadline, mark watched,
  finalize, request/approve/cancel reset). Turn passes only when everyone watched+rated; reset wipes
  only on unanimous approval (atomically, inside `approveReset`); you can only mark yourself watched;
  only the spinner spins. **OFF by default** (`useFunctions=false` in `js/firebase.js`; Functions SDK
  lazy-loaded) so the live app is unchanged until you opt in. **[Blaze + `firebase deploy --only
  functions`, flip the flag, publish `functions/firestore.rules`]** — guide in `functions/README.md`.
- [x] **9. Portable identity** — *built; needs the Email-link provider enabled in console* — optional
  "Save your account" (email-link) that links onto the anonymous account in place (same uid), and on a
  new device / cleared browser recovers that uid; `joinGroup` then reclaims your existing seat instead
  of duplicating you. `session.js` + an Account modal. Inert until used. **[console: enable Email link
  provider]** (README step 5).
- [x] **10. serverTimestamp ordering guard** — the wheel/history sorts already fall back to
  `Date.now()` (not `0`) while `serverTimestamp()` is null-until-acked, so fresh items sort as
  "newest" and don't jump when the real value lands. Locked in with a comment so it isn't regressed.

## P2 — Performance & cost

- [~] **11. Fewer / narrower listeners** — *renders coalesced* (`scheduleRender`, `setTimeout(0)`) so a
  burst of the four listeners rebuilds the DOM once, not four times. The deeper read-cost win
  (live-listen only the current round's ratings + load the archive on demand, or a denormalized
  group-state doc) is **documented but deferred** — it reshapes the data flow and wants emulator
  testing before touching the live app; small clubs are fine as-is. (`js/app.js`, ARCHITECTURE.)
- [n/a] **12. `count()` aggregation for stats** — not worth it for this design: the stats need the
  actual ratings/movies (scores, reviews, genres), which the live listeners already load, so an extra
  server-side `count()` query would add reads, not save them. Revisit only alongside #11's archive
  split (where the full history is no longer in memory).

## P3 — Architecture

- [x] **13. Decision:** stay on Firebase + a thin, **optional** Cloud Functions layer for privileged
  ops (built in #8). Off by default to preserve the zero-backend static deploy; opt in for hard
  guarantees. The static front end stays no-build either way.

## P4 — Features

- [x] **14. TMDB** — *built; needs a free key* — title autocomplete + posters in the add-film box;
  picking a result stores year/runtime/genres (shown on the film card, wheel list and history).
  Off by default (blank `TMDB_API_KEY` in `js/tmdb.js`, no requests until set); required attribution
  shown in-app. **[get a free TMDB v3 key]** (README). Genre/runtime now feed richer stats (#20).
- [x] **15. "Where to watch"** — the film-of-the-week card shows streaming providers (TMDB watch
  providers for the browser's region), fetched once per film and cached, with the required JustWatch
  credit + link. Only for TMDB-added films; hidden when there's no data. (`js/tmdb.js`, `js/app.js`.)
- [x] **16. Accessibility pass** — consistent `:focus-visible` rings on every control, keyboard-operable
  half-star widget (focus previews like hover) with group semantics, dialog roles + `aria-modal` +
  Escape-to-close on modals, an `aria-live` region announcing the pick / whose turn, a labelled wheel
  canvas, and a `prefers-reduced-motion` guard. (Deeper per-theme contrast tuning can still follow.)
- [ ] **17. Ranked-choice "vote" mode** as an alternative to spinning.
- [x] **18. PWA** — `manifest.webmanifest` + generated maskable icons + a service worker (`sw.js`):
  installable to a home screen, instant cached shell, offline fallback. The SW only touches
  same-origin GETs (network-first HTML, stale-while-revalidate assets), so Firebase/TMDB are never
  intercepted. Bump `CACHE` in `sw.js` to force-refresh assets.
- [~] **19. Web push reminders** — *scaffolded (deadline nudges); needs a VAPID key + deploy.*
  Opt-in client (`js/push.js`) + `firebase-messaging-sw.js` + scheduled `sendDeadlineReminders`
  function. Off by default. iOS needs the app installed to the home screen for Web Push. Your-turn /
  reviews-unsealed nudges can follow the same path (add triggers in `functions/`).
- [x] **20. Richer stats** from TMDB metadata — a "Watch habits" card (total hours + average length,
  top genres, films by decade) that appears on the Stats tab only once watched films carry TMDB
  metadata (#14). Degrades to nothing when absent. (`js/stats.js`.)
- [ ] 21. Nice-to-have: live lobby/presence, per-film discussion threads, season recap.

---

## Key sources
- Insecure auth-only rules: https://cloud.google.com/firestore/docs/security/insecure-rules
- Anonymous auth (cleanup, linking): https://firebase.google.com/docs/auth/web/anonymous-auth · https://firebase.blog/posts/2023/07/best-practices-for-anonymous-authentication/
- Rules conditions / membership / list-vs-get: https://firebase.google.com/docs/firestore/security/rules-conditions · https://firebase.google.com/docs/firestore/security/rules-query
- API keys are not secret: https://firebase.google.com/docs/projects/api-keys
- App Check: https://firebase.google.com/docs/app-check/web/recaptcha-provider
- Transactions (contention, idempotency): https://firebase.google.com/docs/firestore/transaction-data-contention · https://firebase.google.com/docs/firestore/manage-data/transactions
- Pricing / listener billing: https://firebase.google.com/pricing · https://docs.cloud.google.com/firestore/native/docs/billing-questions
- Email-link auth: https://firebase.google.com/docs/auth/web/email-link-auth
- TMDB attribution: https://www.themoviedb.org/about/logos-attribution
