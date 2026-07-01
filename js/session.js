// ============================================================================
//  Session: who am I on this browser?
// ----------------------------------------------------------------------------
//  No login. We keep a stable, random memberId + a display name in
//  localStorage so the browser remembers you, and we sign in anonymously so
//  Firestore security rules can block the open internet.
// ============================================================================

import {
  auth,
  signInAnonymously,
  onAuthStateChanged,
  isConfigured,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  EmailAuthProvider,
  linkWithCredential,
} from "./firebase.js";

const MEMBER_ID_KEY = "storyclub_member_id";
const NAME_KEY = "storyclub_name";
const LAST_GROUP_KEY = "storyclub_last_group";
const EMAIL_KEY = "storyclub_email_for_signin";

// The Firebase anonymous auth uid — the identity the security rules trust.
// Available once ensureAuth() has resolved (init() awaits it before any writes).
export function getUid() {
  return auth && auth.currentUser ? auth.currentUser.uid : null;
}

export function getMemberId() {
  let id = localStorage.getItem(MEMBER_ID_KEY);
  if (!id) {
    id =
      "m_" +
      (crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(MEMBER_ID_KEY, id);
  }
  return id;
}

// Adopt a specific memberId (used to reclaim an existing club seat when we
// recover our account on a new device — see joinGroup).
export function setMemberId(id) {
  if (id) localStorage.setItem(MEMBER_ID_KEY, id);
}

export function getName() {
  return localStorage.getItem(NAME_KEY) || "";
}

export function setName(name) {
  localStorage.setItem(NAME_KEY, (name || "").trim());
}

export function getLastGroup() {
  return localStorage.getItem(LAST_GROUP_KEY) || "";
}

export function setLastGroup(code) {
  if (code) localStorage.setItem(LAST_GROUP_KEY, code);
  else localStorage.removeItem(LAST_GROUP_KEY);
}

let authPromise = null;

// Resolves (once) when auth is ready. Cached so it only runs once. Signs in
// anonymously ONLY when nobody is signed in — so a persisted account (e.g. one
// linked to an email via "Save your account") is kept instead of being replaced
// by a fresh anonymous user on every return visit.
export function ensureAuth() {
  if (authPromise) return authPromise;
  authPromise = new Promise((resolve, reject) => {
    if (!isConfigured) {
      reject(new Error("Firebase is not configured yet."));
      return;
    }
    onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
      else signInAnonymously(auth).catch(reject);
    });
  });
  return authPromise;
}

// ---- optional portable identity (email-link sign-in) -----------------------
// Anonymous auth is per-browser: clear your storage or switch devices and you'd
// lose your club. Linking an email onto the anonymous account keeps the SAME
// uid, so your membership survives — and on a new device, signing in with the
// same email recovers that uid. Requires the Email-link provider enabled in the
// Firebase console; entirely optional, nothing breaks if it's never used.

// Has this browser's account been saved (linked to an email, not just anon)?
export function isAccountSaved() {
  return !!(auth && auth.currentUser && !auth.currentUser.isAnonymous);
}

export function getAccountEmail() {
  return (auth && auth.currentUser && auth.currentUser.email) || "";
}

// Email the user a one-time sign-in link to save / restore their account.
export async function sendAccountLink(email) {
  email = (email || "").trim();
  if (!email) throw new Error("Enter your email address.");
  const last = getLastGroup();
  const url = location.origin + location.pathname + (last ? "?g=" + encodeURIComponent(last) : "");
  await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  localStorage.setItem(EMAIL_KEY, email);
}

// Is the page currently loaded from one of those sign-in links?
export function isEmailSignInLink() {
  try {
    return isConfigured && isSignInWithEmailLink(auth, location.href);
  } catch (_) {
    return false;
  }
}

// Finish an email-link sign-in. Links onto the current anonymous account when
// possible (keeps the uid + data); otherwise signs in as the existing account
// (recovers the original uid). `promptForEmail` is called only if we don't have
// the address stored (e.g. the link was opened on a different device).
export async function completeEmailLinkSignIn(promptForEmail) {
  if (!isEmailSignInLink()) return { completed: false };
  let email = localStorage.getItem(EMAIL_KEY);
  if (!email && typeof promptForEmail === "function") email = await promptForEmail();
  if (!email) return { completed: false, needEmail: true };

  const cred = EmailAuthProvider.credentialWithLink(email, location.href);
  try {
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      await linkWithCredential(auth.currentUser, cred); // upgrade in place
    } else {
      await signInWithEmailLink(auth, email, location.href);
    }
  } catch (e) {
    // Email already belongs to a permanent account (linked elsewhere): just sign
    // in as it, recovering that original uid.
    if (e && (e.code === "auth/credential-already-in-use" || e.code === "auth/email-already-in-use")) {
      await signInWithEmailLink(auth, email, location.href);
    } else {
      localStorage.removeItem(EMAIL_KEY);
      throw e;
    }
  }
  localStorage.removeItem(EMAIL_KEY);
  return { completed: true };
}
