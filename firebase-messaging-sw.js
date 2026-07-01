/* StoryClub — Firebase Cloud Messaging background service worker.
 * --------------------------------------------------------------------------
 * Handles push notifications when no tab is focused (the page itself handles
 * them while open, via onForegroundMessage in firebase.js). This file is only
 * registered when Web Push is turned on (a VAPID key is set in firebase.js and
 * a member opts in), so the default build never fetches it.
 *
 * FCM requires a *separate* service worker from the app shell (sw.js) and one
 * that uses the compat SDK via importScripts. The Firebase config below is the
 * same public web config as js/firebase.js — keep them in sync if it changes.
 * (A web API key is not a secret: it identifies the project, it doesn't grant
 * access — access is governed by the security rules.)
 * -------------------------------------------------------------------------- */

importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDzN713jEcl5qKB7vsj9z0fLrda7v8TzQQ",
  authDomain: "cinewheel-79636.firebaseapp.com",
  projectId: "cinewheel-79636",
  storageBucket: "cinewheel-79636.firebasestorage.app",
  messagingSenderId: "456572534465",
  appId: "1:456572534465:web:988135022809e23e771e40",
});

const messaging = firebase.messaging();

// Data-only messages from the Cloud Function: render the notification here so
// we control the icon and the click-through URL.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || "StoryClub";
  const options = {
    body: d.body || "",
    icon: "./assets/icon.svg",
    badge: "./assets/icon.svg",
    tag: d.tag || "storyclub",
    data: { url: d.url || "./" },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
