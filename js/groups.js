// ============================================================================
//  Groups: create / join by code (Kahoot-style), members & turn rotation
// ============================================================================

import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  arrayUnion,
  writeBatch,
  query,
  where,
  useFunctions,
  callFunction,
} from "./firebase.js";
import { getMemberId, getName, getUid, setMemberId } from "./session.js";

// Unambiguous alphabet — no 0/O, 1/I to avoid confusion when sharing codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function normaliseCode(code) {
  return (code || "").trim().toUpperCase();
}

// Create a brand-new group; returns its share code.
export async function createGroup(groupName) {
  const memberId = getMemberId();
  const name = getName();
  const uid = getUid();

  let code = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomCode();
    const snap = await getDoc(doc(db, "groups", candidate));
    if (!snap.exists()) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error("Couldn't generate a free code — please try again.");

  await setDoc(doc(db, "groups", code), {
    name: (groupName || "").trim() || "Book Club",
    createdAt: serverTimestamp(),
    // No createdByName — names aren't denormalised onto the world-readable group doc.
    adminMemberId: memberId,            // the creator runs the club (can kick)
    memberOrder: [memberId],
    memberUids: uid ? [uid] : [],
    currentSpinnerIndex: 0,
    currentFilm: null,
    lastSpin: null,
  });
  await setDoc(doc(db, "groups", code, "members", memberId), {
    name,
    uid,
    joinedAt: serverTimestamp(),
  });
  return code;
}

// Join an existing group by code. Also used to refresh your name on return.
export async function joinGroup(rawCode) {
  const code = normaliseCode(rawCode);
  let memberId = getMemberId();
  const name = getName();
  const uid = getUid();
  const groupRef = doc(db, "groups", code);

  const snap = await getDoc(groupRef);
  if (!snap.exists()) throw new Error("No group found with that code.");

  // Removed by the admin? Block the rejoin (soft — a fresh anonymous identity
  // could still get in; real enforcement would be server-side).
  const gd = snap.data();
  if ((gd.bannedUids || []).includes(uid) || (gd.bannedMemberIds || []).includes(memberId)) {
    throw new Error("You've been removed from this club.");
  }

  // Portable identity: if our auth uid already belongs to this club but our
  // local memberId isn't a known seat (e.g. we recovered our account via
  // email-link on a new device or after a cache wipe), reclaim that existing
  // seat instead of creating a duplicate. Normal return visits — where our
  // memberId is already in the rotation — skip this entirely.
  const order = snap.data().memberOrder || [];
  if (uid && (snap.data().memberUids || []).includes(uid) && !order.includes(memberId)) {
    try {
      const mine = await getDocs(
        query(collection(db, "groups", code, "members"), where("uid", "==", uid))
      );
      const seat = mine.docs.find((d) => d.id !== memberId);
      if (seat) {
        memberId = seat.id;
        setMemberId(memberId);
      }
    } catch (_) { /* unreadable — proceed as new */ }
  }

  // Upsert our member record (keeps name fresh on every join).
  await setDoc(
    doc(db, "groups", code, "members", memberId),
    { name, uid, joinedAt: serverTimestamp() },
    { merge: true }
  );

  // Append to the rotation + record our auth uid (the membership the security
  // rules check) only if we're new to this group.
  await runTransaction(db, async (tx) => {
    const data = (await tx.get(groupRef)).data() || {};
    const order = data.memberOrder || [];
    const uids = data.memberUids || [];
    const updates = {};
    if (!order.includes(memberId)) updates.memberOrder = [...order, memberId];
    if (uid && !uids.includes(uid)) updates.memberUids = [...uids, uid];
    if (Object.keys(updates).length) tx.update(groupRef, updates);
  });
  return code;
}

// Whose turn is it to spin? Returns the memberId, or null if no members yet.
export function currentSpinnerId(group) {
  const order = group?.memberOrder || [];
  if (order.length === 0) return null;
  const raw = group.currentSpinnerIndex || 0;
  const i = ((raw % order.length) + order.length) % order.length;
  return order[i];
}

// Admin action: remove a member from the club. Drops them from the rotation and
// from memberUids (so the security rules stop trusting them), bans the id/uid so
// they can't immediately rejoin with the code, fixes the spinner pointer, and
// best-effort deletes their member record. Client-trusted, like the rest of the
// rotation logic — meant for a friendly club, not a hostile-actor guard.
export async function kickMember(code, memberId, uid) {
  const ref = doc(db, "groups", code);
  await runTransaction(db, async (tx) => {
    const g = (await tx.get(ref)).data() || {};
    const order = g.memberOrder || [];
    const idx = order.indexOf(memberId);
    if (idx === -1) return; // already gone
    const newOrder = order.filter((id) => id !== memberId);
    const updates = {
      memberOrder: newOrder,
      memberUids: (g.memberUids || []).filter((u) => u !== uid),
      bannedMemberIds: Array.from(new Set([...(g.bannedMemberIds || []), memberId])),
    };
    if (uid) updates.bannedUids = Array.from(new Set([...(g.bannedUids || []), uid]));
    // Keep the spinner pointing at the same person (or wrap if needed).
    let spin = g.currentSpinnerIndex || 0;
    if (idx < spin) spin -= 1;
    updates.currentSpinnerIndex = newOrder.length
      ? ((spin % newOrder.length) + newOrder.length) % newOrder.length : 0;
    const rr = g.resetRequest;
    if (rr) updates.resetRequest = { ...rr, approvals: (rr.approvals || []).filter((id) => id !== memberId) };
    tx.update(ref, updates);
  });
  // Tidy up their record (needs the relaxed members-delete rule; harmless if it
  // fails — they're already out of memberOrder, so nothing counts them).
  try { await deleteDoc(doc(db, "groups", code, "members", memberId)); } catch (_) {}
}

// Update this group's display name.
export async function renameGroup(code, newName) {
  await updateDoc(doc(db, "groups", code), { name: (newName || "").trim() || "Book Club" });
}

// Toggle "limit the wheel to a fixed number of books" for the whole club, so a
// big wheel stays readable. Club-wide (not per-user) so everyone sees the same
// wheel and spins from the same pool no matter whose turn it is.
export async function setWheelCap(code, capped) {
  await updateDoc(doc(db, "groups", code), { wheelCapped: !!capped });
}

// ---- group reset (requires unanimous approval) -----------------------------
// A member proposes a reset; it only actually happens once EVERY current member
// has approved. Anyone declining (or the proposer cancelling) clears it.

export async function requestReset(code, memberId, name) {
  if (useFunctions) {
    await callFunction("requestReset", { code });
    return;
  }
  await updateDoc(doc(db, "groups", code), {
    resetRequest: {
      startedBy: memberId, // name resolved from members at render, not stored on the group doc
      startedAt: Date.now(),
      approvals: [memberId], // the proposer approves by definition
    },
  });
}

// Add my approval (only if a request is still open). In server-authoritative
// mode the function also performs the wipe atomically once it's unanimous.
export async function approveReset(code, memberId) {
  if (useFunctions) {
    await callFunction("approveReset", { code });
    return;
  }
  const ref = doc(db, "groups", code);
  await runTransaction(db, async (tx) => {
    const rr = (await tx.get(ref)).data()?.resetRequest;
    if (!rr) return;
    const approvals = Array.from(new Set([...(rr.approvals || []), memberId]));
    tx.update(ref, { resetRequest: { ...rr, approvals } });
  });
}

// Decline / cancel — clears the whole request.
export async function cancelReset(code) {
  if (useFunctions) {
    await callFunction("cancelReset", { code });
    return;
  }
  await updateDoc(doc(db, "groups", code), { resetRequest: null });
}

// Wipe the club's films, ratings and history; keep members and the code.
// Run once everyone has approved. Idempotent enough for our needs.
//
// Deletes are chunked: under the member-locked rules each delete triggers a
// membership get(), and a batched write may make at most 20 such document-
// access calls. Small batches keep us comfortably under that ceiling.
export async function performReset(code) {
  // In server-authoritative mode the wipe already happened inside approveReset
  // (server-side, when the last approval landed), so there's nothing to do here.
  if (useFunctions) return;
  const [moviesSnap, ratingsSnap, commentsSnap] = await Promise.all([
    getDocs(collection(db, "groups", code, "movies")),
    getDocs(collection(db, "groups", code, "ratings")),
    getDocs(collection(db, "groups", code, "comments")),
  ]);
  const refs = [...moviesSnap.docs, ...ratingsSnap.docs, ...commentsSnap.docs].map((d) => d.ref);
  const CHUNK = 15;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db);
    refs.slice(i, i + CHUNK).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  await updateDoc(doc(db, "groups", code), {
    currentFilm: null,
    lastSpin: null,
    currentSpinnerIndex: 0,
    resetRequest: null,
  });
}
