// ============================================================================
//  Firebase initialisation for StoryClub
// ----------------------------------------------------------------------------
//  This is the ONLY file you need to edit to connect your own Firebase project.
//  Follow README.md (steps 1–6) to get these values, then paste them below.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  EmailAuthProvider,
  linkWithCredential,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  arrayUnion,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Your web app's Firebase configuration.
const firebaseConfig = {
  apiKey: "AIzaSyDzN713jEcl5qKB7vsj9z0fLrda7v8TzQQ",
  authDomain: "cinewheel-79636.firebaseapp.com",
  projectId: "cinewheel-79636",
  storageBucket: "cinewheel-79636.firebasestorage.app",
  messagingSenderId: "456572534465",
  appId: "1:456572534465:web:988135022809e23e771e40",
};

// Optional Firebase App Check (reCAPTCHA v3): anti-abuse defense-in-depth so
// only your real site can reach Firebase, even though the API key is public.
// OFF by default — leave this blank and nothing changes (the App Check SDK
// isn't even fetched, so there's zero cost until you turn it on). To enable:
// register the site in the Firebase console (App Check -> reCAPTCHA v3), paste
// the SITE key below, then start enforcement in "monitor" mode and flip to
// enforce once traffic looks clean. See README.md.
const recaptchaV3SiteKey = "6LcR0DYtAAAAAG56hre2vAygrXMRzfMdgwBoCz_P";

// Optional Web Push (Firebase Cloud Messaging) for deadline / turn reminders.
// OFF by default — leave this blank and nothing changes (the Messaging SDK is
// never fetched, so there's zero cost and no permission prompt until you turn
// it on). To enable: in the Firebase console, Project settings -> Cloud
// Messaging -> Web Push certificates, generate a key pair, and paste the
// public "VAPID key" below. You also need firebase-messaging-sw.js at the site
// root (already in the repo) and the scheduled reminder Cloud Function
// deployed (functions/, sendDeadlineReminders). See README step 8.
export const messagingVapidKey = "";

// True once real values (not the placeholders) are filled in above.
export const isConfigured =
  !!firebaseConfig.apiKey &&
  !/REPLACE_ME|YOUR_API_KEY/i.test(firebaseConfig.apiKey) &&
  !!firebaseConfig.projectId;

// Only initialise when configured, so an unconfigured copy shows the setup
// screen instead of throwing at import time.
let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  enableAppCheck(app);
  auth = getAuth(app);
  db = getFirestore(app);
}

// App Check is opt-in: only when a site key is set do we lazy-load its SDK and
// initialise it, so the default build pays nothing for a feature that's off.
function enableAppCheck(firebaseApp) {
  if (!recaptchaV3SiteKey) return;
  import("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-check.js")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) =>
      initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(recaptchaV3SiteKey),
        isTokenAutoRefreshEnabled: true,
      })
    )
    .catch((e) => console.error("App Check failed to initialise:", e));
}

// ---- optional server-authoritative mode (Cloud Functions) ------------------
// OFF by default. When you deploy the functions in functions/ and set this to
// true, the privileged round/turn/reset writes route through callable functions
// instead of being written by the client. The Functions SDK is lazy-loaded, so
// the default build never fetches it. See functions/README.md.
export const useFunctions = false;
const FUNCTIONS_REGION = "us-central1";

let _fnMod = null;
let _functions = null;

// Call a callable Cloud Function by name; returns its data payload (or throws
// the function's HttpsError, whose .message is safe to show the user).
export async function callFunction(name, data) {
  if (!_fnMod) {
    _fnMod = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js");
  }
  if (!_functions) _functions = _fnMod.getFunctions(app, FUNCTIONS_REGION);
  const res = await _fnMod.httpsCallable(_functions, name)(data);
  return res.data;
}

// ---- optional Web Push (Firebase Cloud Messaging) --------------------------
// Lazy-loaded only when a VAPID key is set, so the default build never fetches
// the Messaging SDK. getMessagingToken() registers the FCM service worker,
// asks for notification permission, and returns the device token to store on
// the member doc; onForegroundMessage() lets the app show in-page messages
// while a tab is focused (the SW handles them when it isn't).
let _messaging = null;
async function getMessaging() {
  if (!messagingVapidKey || !app) return null;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return null;
  if (!_messaging) {
    const mod = await import(
      "https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging.js"
    );
    if (!(await mod.isSupported().catch(() => false))) return null;
    _messaging = { mod, instance: mod.getMessaging(app) };
  }
  return _messaging;
}

export async function getMessagingToken() {
  const m = await getMessaging();
  if (!m) return null;
  const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;
  return m.mod.getToken(m.instance, {
    vapidKey: messagingVapidKey,
    serviceWorkerRegistration: reg,
  });
}

export async function onForegroundMessage(handler) {
  const m = await getMessaging();
  if (!m) return () => {};
  return m.mod.onMessage(m.instance, handler);
}

// Re-export everything the rest of the app needs, so other modules import from
// one place and we never mismatch SDK versions.
export {
  app,
  auth,
  db,
  signInAnonymously,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  EmailAuthProvider,
  linkWithCredential,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  arrayUnion,
  writeBatch,
  Timestamp,
};
