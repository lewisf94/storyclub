// ============================================================================
//  Web Push reminders (optional) — deadline / your-turn / reviews-unsealed
// ----------------------------------------------------------------------------
//  OFF by default. This is inert until a Web Push VAPID key is set in
//  firebase.js AND the scheduled reminder Cloud Function is deployed. When on,
//  a member opts in from the Account modal; we ask for notification permission,
//  fetch this device's FCM token, and store it on their member doc
//  (`pushTokens`). The Cloud Function (functions/, sendDeadlineReminders) reads
//  those tokens to push deadline nudges. Tokens are per-device, so a member may
//  accumulate a few; the function prunes any the FCM API reports as stale.
// ============================================================================

import {
  db,
  doc,
  updateDoc,
  arrayUnion,
  messagingVapidKey,
  getMessagingToken,
} from "./firebase.js";

// Is push even an option in this build/browser? (Key set + SW + Notifications.)
export function pushAvailable() {
  return (
    !!messagingVapidKey &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

// Current OS-level permission: "default" (unasked), "granted", or "denied".
export function pushPermission() {
  return pushAvailable() ? Notification.permission : "denied";
}

// Opt this device in: request permission, get a token, save it to the member
// doc. Returns true on success. Throws nothing the caller must handle — it
// resolves false if the user declines or it isn't supported.
export async function enablePush(code, memberId) {
  if (!pushAvailable() || !code || !memberId) return false;
  const token = await getMessagingToken();
  if (!token) return false; // declined, or unsupported in this browser
  await updateDoc(doc(db, "groups", code, "members", memberId), {
    pushTokens: arrayUnion(token),
    pushUpdatedAt: Date.now(),
  });
  return true;
}
