# StoryClub — security to-do

_A working checklist from the 2026-06-26 security deep-dive. Tick items as we go.
Complements the `SH-*` items in [ROADMAP.md](./ROADMAP.md) — this is the
prioritised, actionable version. Most "code" items are small; most "console"
items only the project owner can do._

**Legend:** `[console/you]` = Firebase/Google Cloud console action only you can do ·
`[code/claude]` = a code change I can land on `main` · severity in **bold**.

## Suggested order
1. Verify the deployed rules (#1) — everything else assumes the rules are actually the locked ones.
2. Turn on App Check (#2).
3. Code hardenings (#5–#8) in any order.
4. Low-priority / optional housekeeping (#3, #4, #9–#12).

---

## Do first

- [x] **1. [console/you] CRITICAL — deployed rules confirmed + republished.** The deployed rules were
  already the hardened member-locked set (NOT permissive/test-mode), so data was never wide open. Pasted
  the latest repo `firestore.rules` (incl. the #6 film-identity hardening) and **Published**. Good practice
  still: if many old members haven't opened the app since uid-recording went live, have them re-join once.

- [x] **2. [console/you] HIGH — enable App Check (reCAPTCHA v3).** DONE & verified: site key live,
  metrics showed 100% verified (33/33, 0 unverified), enforcement ON for Cloud Firestore, and the app
  loads cleanly in an incognito window with enforcement on. The "CAPTCHA option" you saw.
  Without it, the public API key + anonymous auth let anyone script Firestore directly (code
  brute-forcing, scraping, cost abuse), bypassing the site. reCAPTCHA **v3 is invisible** (no user
  challenge). Code is already scaffolded (`enableAppCheck()` + `recaptchaV3SiteKey` in `js/firebase.js`).
  - Build → **App Check → Apps** → register the web app with **reCAPTCHA v3** → copy the **site key**.
  - Paste it into `recaptchaV3SiteKey` in `js/firebase.js`, commit, deploy. _(I can do this paste step once you have the key — see #2b.)_
  - App Check → **APIs** → enforce for **Cloud Firestore** (and Auth): start in **Monitor**, watch a day or two that real `lewisf94.github.io` traffic passes, **then** flip to **Enforce**. (Going straight to Enforce with a misconfigured key can lock out real users.)
  - README **step 7** has click-by-click.
  - [x] **2b. [code/claude]** Site key wired into `js/firebase.js` (`recaptchaV3SiteKey`) and pushed; the
    app initialises App Check and sends reCAPTCHA v3 tokens. Verified end-to-end (see #2).

---

## Code hardenings (I can do these)

- [x] **5. [code/claude] MEDIUM — stop leaking member names via a guessed code (SH-3).** Done (client +
  Functions; no rules change, so the client half is live on push via Pages). Removed every denormalised
  name from the world-readable group doc: `createdByName` (was unused), `currentFilm.spinnerName` →
  `spinnerMemberId`, `currentFilm.addedByName` (now resolved from the member-locked movie doc),
  `lastSpin.spinnerName` (was unused), and `vote`/`resetRequest` `startedByName` → resolve from
  `startedBy`. Names resolve from the member-locked subcollection at render via a new `memberName()`
  helper (with a legacy fallback so in-flight rounds don't blank out). Mirrored in `functions/index.js`.
  _Residual: group-doc `get` still exposes the **club name + current film title** (lower-sensitivity;
  fully closing needs longer codes or a bigger redesign — App Check (#2) is the better lever)._

- [x] **6. [code/claude] MEDIUM — make a film's identity immutable.** Done in `firestore.rules`.
  Split the `movies` rule into create/update/delete: `title`/`addedByMemberId`/`addedByName` can't be
  changed after creation (no rewriting another member's title or stealing authorship), and create
  requires `status=='wheel'` + a title cap. Field updates (watchedBy / removeVotes / serviceOverride /
  spin / finalize) stay open because members run the round client-side, and **delete stays open** (the
  adder's remove, vote-off, and the reset all need it). _Full delete-griefing protection needs
  server-authoritative (Functions) mode — see #11 / SH-7._
  **⚠ Requires re-publishing the live rules (#1) to take effect.**

- [x] **7. [code/claude] LOW — add a Referrer-Policy meta.** Done — added
  `<meta name="referrer" content="strict-origin-when-cross-origin">` to `index.html` `<head>` so the
  club code in an invite link can't leak via `Referer` to TMDB/CDNs. (Auto-deploys via Pages.)

- [x] **8. [code/claude] LOW — harden the optional hardened rules' value types.** Done in
  `functions/firestore.rules`: the member-writable allowlist (`name`, `streamFilter`, `wheelCapped`)
  now requires the two toggles to be `bool` and caps `name` length on update. (Only active if you ever
  enable Functions mode.)

---

## Low-priority / optional

- [ ] **3. [console/you] LOW — anonymous-account auto-cleanup (SH-5).**
  Authentication → **Settings** → enable auto-delete of anonymous accounts older than 30 days, so
  throwaway anon identities don't accumulate (mild cost/clutter).

- [ ] **4. [console/you] LOW — restrict the Web API key by HTTP referrer.**
  Google Cloud Console → APIs & Services → **Credentials** → the browser API key → Application
  restrictions → **HTTP referrers** → allow `https://lewisf94.github.io/*` **and** the auth-handler
  domains (`cinewheel-79636.firebaseapp.com/*`, `cinewheel-79636.web.app/*`). Soft layer, not a
  boundary. (README; ROADMAP #6.)

- [ ] **9. [console/you] LOW — (optional) Auth bot protection.** If you saw a CAPTCHA option under
  **Authentication → Settings**, that's reCAPTCHA abuse protection for the **sign-in/email-link** flow
  (guards auth abuse, not Firestore data). Lower priority than App Check (#2); enable if you want extra
  protection on the email-link path.

- [ ] **10. [code/claude] LOW — rotate the exposed TMDB key, and/or proxy it.**
  `TMDB_API_KEY` (`js/tmdb.js:18`) is a real, active key committed to a public repo and shipped to every
  client — it's effectively already harvestable. It's read-only (worst case: quota/rate-limit abuse on
  *your* key). Options: (a) regenerate it in TMDB and paste the new one; (b) longer-term, proxy TMDB
  through a small function to keep the key server-side.

- [ ] **11. [code/claude] INFO — SH-9: make the vote feature server-authoritative.**
  Pre-existing. `startVote` / vote-to-remove / `serviceOverride` write the group doc directly with no
  callable, so they'd be **denied** under the hardened `functions/firestore.rules` if Functions mode is
  ever enabled. Only relevant if/when you turn on Functions mode; add the callables (or relax those
  low-stakes writes) then. (ROADMAP SH-9.)

- [ ] **12. [console/you] INFO — (not security) email sender still says `cinewheel-79636`.**
  Project Settings → General → set **Public-facing name** to **StoryClub**. Carried over from
  HANDOFF "Needs YOU"; listed here so it isn't lost.

---

## Verified clean — no action needed (recorded so we don't re-audit)
- **No XSS.** Every user-controlled string (names, titles, reviews, comments, club name, genres, stats
  feed) is `esc()`-escaped before render; reviews/comments go through `renderReview` (escape-then-markup);
  screen-reader text uses `textContent`; confirmations use native dialogs.
- **No leaked admin secrets** — no service-account JSON, `.env`, or private keys tracked; `functions/`
  ships only code.
- **Emails stay out of Firestore** — only in Firebase Auth + local `localStorage`.
- **Subcollections are member-locked**, `list` is denied (no club enumeration), ratings/comments are
  **author-pinned** (SH-8), join is **append-only** (SH-4), and review/comment/name **size caps** exist (SH-6).
- The public **Firebase web config** (`apiKey`, etc.) being in the repo is **normal** — not a secret; the
  rules (+ App Check, #2) are the real boundary.

---

_Last updated: 2026-06-26._
