// ============================================================================
//  StoryClub Cloud Functions — server-authoritative round / turn / reset rules
// ----------------------------------------------------------------------------
//  These callable functions own every write that affects SHARED club state, so
//  the invariants are enforced by the server (Admin SDK, which bypasses the
//  security rules) instead of being trusted to the client:
//    - commitSpin     only the current spinner, only when no film is in play,
//                     and only onto a real wheel film
//    - setDeadline    only for the film actually in play
//    - markWatched    you can only mark YOURSELF watched (feeds finalize)
//    - finalizeRound  the turn passes only when EVERY member has watched AND
//                     rated (the spinner may force an early wrap-up)
//    - requestReset / approveReset / cancelReset
//                     the wipe happens only on UNANIMOUS approval, atomically,
//                     inside approveReset when the last approval lands
//
//  Turn this on by deploying these functions and flipping `useFunctions` in
//  js/firebase.js to true, then publishing the hardened rules in
//  functions/firestore.rules (which forbid clients from writing these fields
//  directly). See functions/README.md. Requires the Blaze plan.
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

const DEFAULT_DEADLINE_DAYS = 28; // a book club reads over weeks, not days
const SPIN_DURATION_MS = 11500;
const REMIND_WITHIN_MS = 48 * 3600 * 1000; // nudge once the deadline is ≤48h away

function requireAuthUid(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return uid;
}

function requireCode(request) {
  const code = request.data && request.data.code;
  if (!code || typeof code !== "string") {
    throw new HttpsError("invalid-argument", "Missing group code.");
  }
  return code;
}

// Load the group and resolve the caller's memberId — they must be a recorded
// member (uid in memberUids, and a member doc carrying that uid).
async function loadMembership(request) {
  const uid = requireAuthUid(request);
  const code = requireCode(request);
  const groupRef = db.doc(`groups/${code}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new HttpsError("not-found", "No such club.");
  const group = groupSnap.data();
  if (!(group.memberUids || []).includes(uid)) {
    throw new HttpsError("permission-denied", "You are not a member of this club.");
  }
  const membersSnap = await db.collection(`groups/${code}/members`).get();
  let memberId = null;
  let memberName = "";
  membersSnap.forEach((d) => {
    const m = d.data();
    if (m.uid === uid) {
      memberId = d.id;
      memberName = m.name || "";
    }
  });
  if (!memberId) throw new HttpsError("permission-denied", "No member record for you here.");
  return { uid, code, groupRef, group, memberId, memberName };
}

function currentSpinnerMemberId(group) {
  const order = group.memberOrder || [];
  if (!order.length) return null;
  const raw = group.currentSpinnerIndex || 0;
  const i = ((raw % order.length) + order.length) % order.length;
  return order[i];
}

// ---- commitSpin ------------------------------------------------------------
// The client still picks the winner (the randomness isn't a trust boundary —
// it's a party wheel); the server enforces who/when and that it's a real film.
exports.commitSpin = onCall(async (request) => {
  const { code, groupRef, group, memberId } = await loadMembership(request);
  if (group.currentFilm) throw new HttpsError("failed-precondition", "A book is already in play.");
  if (currentSpinnerMemberId(group) !== memberId) {
    throw new HttpsError("permission-denied", "It's not your turn to spin.");
  }
  const segments = Array.isArray(request.data.segments) ? request.data.segments : [];
  const winnerIndex = request.data.winnerIndex;
  if (!segments.length || typeof winnerIndex !== "number" ||
      winnerIndex < 0 || winnerIndex >= segments.length) {
    throw new HttpsError("invalid-argument", "Bad spin payload.");
  }
  const winner = segments[winnerIndex];
  if (!winner || !winner.id) throw new HttpsError("invalid-argument", "Bad winner.");

  const movieRef = db.doc(`groups/${code}/movies/${winner.id}`);
  const movieSnap = await movieRef.get();
  if (!movieSnap.exists || movieSnap.data().status !== "wheel") {
    throw new HttpsError("failed-precondition", "That book isn't on the wheel.");
  }
  const deadlineMs = typeof request.data.deadlineMs === "number"
    ? request.data.deadlineMs
    : Date.now() + DEFAULT_DEADLINE_DAYS * 86400000;
  const deadline = Timestamp.fromMillis(deadlineMs);
  const now = Timestamp.now();
  const stamp = Date.now();

  const batch = db.batch();
  batch.update(movieRef, { status: "current", pickedAt: now, deadline, watchedBy: [] });
  batch.update(groupRef, {
    currentFilm: {
      movieId: winner.id,
      title: winner.title || movieSnap.data().title || "",
      // id not name — the group doc is readable by code, so names would leak;
      // resolved from the member-locked subcollection (and movie doc) at render.
      spinnerMemberId: memberId,
      pickedAt: now,
      deadline,
    },
    lastSpin: {
      seed: stamp,
      startedAt: stamp,
      durationMs: SPIN_DURATION_MS,
      segments: segments.map((s) => ({ id: s.id, title: s.title || "" })),
      winnerIndex,
    },
  });
  await batch.commit();
  return { ok: true };
});

// ---- setDeadline -----------------------------------------------------------
exports.setDeadline = onCall(async (request) => {
  const { code, groupRef, group } = await loadMembership(request);
  const movieId = request.data.movieId;
  const deadlineMs = request.data.deadlineMs;
  if (!movieId || typeof deadlineMs !== "number") {
    throw new HttpsError("invalid-argument", "Bad payload.");
  }
  if (!group.currentFilm || group.currentFilm.movieId !== movieId) {
    throw new HttpsError("failed-precondition", "That book isn't the current one.");
  }
  const deadline = Timestamp.fromMillis(deadlineMs);
  const batch = db.batch();
  batch.update(db.doc(`groups/${code}/movies/${movieId}`), { deadline });
  batch.update(groupRef, { currentFilm: Object.assign({}, group.currentFilm, { deadline }) });
  await batch.commit();
  return { ok: true };
});

// ---- markWatched -----------------------------------------------------------
// Adds ONLY the caller to watchedBy, so finalize's "everyone watched" check is
// honest (a client can't mark other people as having watched).
exports.markWatched = onCall(async (request) => {
  const { code, group, memberId } = await loadMembership(request);
  const movieId = request.data.movieId;
  if (!movieId) throw new HttpsError("invalid-argument", "Missing movieId.");
  if (!group.currentFilm || group.currentFilm.movieId !== movieId) {
    throw new HttpsError("failed-precondition", "That book isn't the current one.");
  }
  await db.doc(`groups/${code}/movies/${movieId}`).update({
    watchedBy: FieldValue.arrayUnion(memberId),
  });
  return { ok: true };
});

// ---- finalizeRound ---------------------------------------------------------
// Passes the turn only when every current member has watched AND rated, unless
// the current spinner forces an early wrap-up. Idempotent.
exports.finalizeRound = onCall(async (request) => {
  const { code, groupRef, group, memberId } = await loadMembership(request);
  const movieId = request.data.movieId;
  const force = request.data.force === true;
  if (!movieId) throw new HttpsError("invalid-argument", "Missing movieId.");
  if (!group.currentFilm || group.currentFilm.movieId !== movieId) {
    return { ok: true, already: true };
  }
  const order = group.memberOrder || [];
  const movieRef = db.doc(`groups/${code}/movies/${movieId}`);
  const movieSnap = await movieRef.get();
  const watchedBy = (movieSnap.exists && movieSnap.data().watchedBy) || [];
  const ratingsSnap = await db.collection(`groups/${code}/ratings`)
    .where("movieId", "==", movieId).get();
  const rated = new Set();
  ratingsSnap.forEach((d) => {
    const r = d.data();
    if (r.memberId) rated.add(r.memberId);
  });
  const everyoneDone = order.length > 0 &&
    order.every((mid) => watchedBy.includes(mid) && rated.has(mid));

  if (!everyoneDone && !(force && currentSpinnerMemberId(group) === memberId)) {
    throw new HttpsError("failed-precondition", "Not everyone has read and rated yet.");
  }
  const nextIndex = order.length ? ((group.currentSpinnerIndex || 0) + 1) % order.length : 0;
  const batch = db.batch();
  batch.update(movieRef, { status: "watched", watchedAt: Timestamp.now() });
  batch.update(groupRef, { currentFilm: null, currentSpinnerIndex: nextIndex });
  await batch.commit();
  return { ok: true };
});

// ---- reset: request / approve(+wipe) / cancel ------------------------------
exports.requestReset = onCall(async (request) => {
  const { groupRef, group, memberId } = await loadMembership(request);
  if (group.resetRequest) return { ok: true, already: true };
  await groupRef.update({
    resetRequest: {
      startedBy: memberId, // name resolved from the member-locked subcollection at render
      startedAt: Date.now(),
      approvals: [memberId],
    },
  });
  return { ok: true };
});

exports.cancelReset = onCall(async (request) => {
  const { groupRef } = await loadMembership(request);
  await groupRef.update({ resetRequest: null });
  return { ok: true };
});

// Adds the caller's approval; if that makes it unanimous, clears the play state
// in the same transaction and then deletes all films + ratings.
exports.approveReset = onCall(async (request) => {
  const { code, groupRef, memberId } = await loadMembership(request);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    const g = snap.data() || {};
    const rr = g.resetRequest;
    if (!rr) return { none: true };
    const approvals = Array.from(new Set([...(rr.approvals || []), memberId]));
    const order = g.memberOrder || [];
    const unanimous = order.length > 0 && order.every((mid) => approvals.includes(mid));
    if (unanimous) {
      tx.update(groupRef, {
        currentFilm: null, lastSpin: null, currentSpinnerIndex: 0, resetRequest: null,
      });
      return { unanimous: true };
    }
    tx.update(groupRef, { resetRequest: Object.assign({}, rr, { approvals }) });
    return { unanimous: false };
  });

  if (outcome.none) throw new HttpsError("failed-precondition", "No reset is in progress.");
  if (!outcome.unanimous) return { ok: true, wiped: false };

  const [moviesSnap, ratingsSnap] = await Promise.all([
    db.collection(`groups/${code}/movies`).get(),
    db.collection(`groups/${code}/ratings`).get(),
  ]);
  const refs = [...moviesSnap.docs, ...ratingsSnap.docs].map((d) => d.ref);
  const CHUNK = 400; // Admin SDK bypasses rules; batch limit is 500 ops.
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = db.batch();
    refs.slice(i, i + CHUNK).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return { ok: true, wiped: true };
});

// ---- web push: deadline reminders (scheduled) ------------------------------
// Runs daily. For every club with a film in play whose deadline is within the
// next REMIND_WITHIN_MS, it pushes a nudge to the members who haven't marked it
// watched yet, on whatever devices they've registered (member doc `pushTokens`,
// set by enablePush in js/push.js). Stale tokens reported by FCM are pruned.
//
// Requires Web Push to be turned on: a VAPID key in js/firebase.js so members
// can register tokens, and this function deployed (Blaze plan). It does nothing
// useful until members have opted in, so it's harmless to deploy early.
exports.sendDeadlineReminders = onSchedule("every day 09:00", async () => {
  const now = Date.now();
  const groupsSnap = await db.collection("groups").get();

  for (const groupDoc of groupsSnap.docs) {
    const group = groupDoc.data();
    const cf = group.currentFilm;
    if (!cf || !cf.deadline) continue;
    const deadlineMs = cf.deadline.toMillis ? cf.deadline.toMillis() : Number(cf.deadline);
    const remaining = deadlineMs - now;
    if (remaining > REMIND_WITHIN_MS) continue; // not close enough yet

    // Who still hasn't watched? (members not in the movie's watchedBy.)
    const movieSnap = await db.doc(`groups/${groupDoc.id}/movies/${cf.movieId}`).get();
    const watchedBy = (movieSnap.exists && movieSnap.data().watchedBy) || [];
    const membersSnap = await db.collection(`groups/${groupDoc.id}/members`).get();

    const body = remaining <= 0
      ? `"${cf.title}" is overdue — finish reading it and leave your rating.`
      : `"${cf.title}" is due ${relativeDeadline(remaining)}. Don't forget to read and rate.`;

    for (const memberDoc of membersSnap.docs) {
      const m = memberDoc.data();
      if (watchedBy.includes(memberDoc.id)) continue; // already watched
      const tokens = Array.isArray(m.pushTokens) ? m.pushTokens : [];
      if (!tokens.length) continue;

      const res = await getMessaging().sendEachForMulticast({
        tokens,
        data: {
          title: "StoryClub — read-by reminder",
          body,
          url: "./?g=" + groupDoc.id,
          tag: "deadline-" + cf.movieId,
        },
      });

      // Prune tokens FCM says are dead, so they don't pile up forever.
      const dead = [];
      res.responses.forEach((r, i) => {
        const code = r.error && r.error.code;
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-argument") {
          dead.push(tokens[i]);
        }
      });
      if (dead.length) {
        await memberDoc.ref.update({ pushTokens: FieldValue.arrayRemove(...dead) });
      }
    }
  }
});

function relativeDeadline(ms) {
  const h = Math.round(ms / 3600000);
  if (h <= 1) return "within the hour";
  if (h < 24) return `in about ${h}h`;
  return `in ${Math.round(h / 24)} day(s)`;
}
