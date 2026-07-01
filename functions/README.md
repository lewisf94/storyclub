# StoryClub Cloud Functions (optional, server-authoritative mode)

By default StoryClub runs **without** these — the static site talks straight to
Firestore and the round/turn/reset invariants are trusted to the client (fine
for a friendly club). Deploying these makes those invariants **server-enforced**
instead: the turn passes only when everyone has read and rated, a reset
happens only on unanimous approval, you can only mark *yourself* as having read,
and only the current spinner can spin. The static front end stays no-build; this is
a separate, optional backend.

**Requires the Blaze (pay-as-you-go) plan.** Cloud Functions aren't available on
the free Spark plan. Blaze still has a generous free monthly allowance; a small
club will almost certainly stay within it.

## What's here

| File | What it is |
|------|-----------|
| `index.js` | The callable functions (`commitSpin`, `setDeadline`, `markWatched`, `finalizeRound`, `requestReset`, `approveReset`, `cancelReset`) **plus** the scheduled `sendDeadlineReminders` (Web Push) |
| `package.json` | Node 20, `firebase-admin` + `firebase-functions` |
| `firestore.rules` | **Hardened** rules to publish *after* this is live (clients can no longer write the shared state directly) |

## Web push reminders (independent of the server-authoritative mode)

`sendDeadlineReminders` is a **scheduled** function (runs daily) that pushes a
read-by nudge to members who haven't read the current book, using the FCM
tokens they registered (`pushTokens` on each member doc). It's independent of
`useFunctions` — you can deploy just it for reminders while leaving the
round/turn/reset invariants client-trusted:

```bash
firebase deploy --only functions:sendDeadlineReminders
```

It does nothing until a **Web Push VAPID key** is set in `js/firebase.js` (so
members can opt in) — full setup in the main [README](../README.md) step 8.
Scheduled functions need the Blaze plan.

## Turn it on

1. **Upgrade to Blaze**: Firebase console → your project → upgrade plan.
2. **Install the CLI** (once): `npm install -g firebase-tools`, then
   `firebase login`.
3. **Point the CLI at your project** from the repo root:
   `firebase use your-project-id` (or `firebase use --add`).
4. **Test locally first** (strongly recommended):
   ```bash
   cd functions && npm install && cd ..
   firebase emulators:start --only functions,firestore,auth
   ```
   Run the app against the emulator and click through: spin, mark read, rate,
   finish a round, and a unanimous reset.
5. **Deploy the functions**:
   ```bash
   firebase deploy --only functions
   ```
   They deploy to the default region **us-central1** — which is what the client
   expects (`FUNCTIONS_REGION` in `js/firebase.js`). If you change the region,
   change it in both places.
6. **Flip the client flag**: in `js/firebase.js` set `useFunctions = true`, then
   commit + push so GitHub Pages redeploys. (Now the app routes spins, read-acks,
   finishes and resets through the functions.)
7. **Publish the hardened rules**: copy `functions/firestore.rules` into the
   Firebase console (Firestore → Rules → Publish). These stop clients writing the
   shared state directly, so the functions become the only path.

> Order matters: deploy functions (5) → flip the flag + redeploy site (6) →
> publish hardened rules (7). If you publish the hardened rules before the
> functions/flag are live, spinning/finishing/resetting will fail until you do.

> **Known gap — the vote feature is not server-authoritative yet.** The approval
> **vote** (start vote / submit ballot / cancel / commit winner) and the
> **vote-to-remove** a wheel book were added after these functions and have **no
> callable** — they still write Firestore directly and don't check `useFunctions`.
> The hardened rules forbid exactly those writes (`vote`/`currentFilm` are
> function-only; book updates are denied), so turning this mode on **silently
> breaks voting and vote-to-remove**. Until functions are added for them, either
> stay in client-trusted mode if your club uses voting, or accept those features
> being disabled under server-authoritative mode.

## Turn it off

Set `useFunctions = false` in `js/firebase.js` (redeploy the site) and re-publish
the root `firestore.rules`. You can leave the deployed functions in place or
`firebase functions:delete` them.
