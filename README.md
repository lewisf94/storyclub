# StoryClub

**Live app → <https://lewisf94.github.io/storyclub/>**

A book-club wheel for groups of friends. Add books to a wheel, take turns each
month spinning to pick what to read, set a read-by deadline, then rate (in
half-stars) and review what you read — reviews stay sealed until the whole club
is in, with stats along the way.

- **No sign-up** — people just enter a name.
- **Multiple groups** — create a group, share its 5-letter code (Kahoot-style),
  and each group's data is kept separate.
- **Saved forever & shared live** — everything is stored in Firebase, so people
  can leave and come back to the same info, and updates appear in real time.
- **Covers, authors & blurbs** — books are enriched from
  [Open Library](https://openlibrary.org) (no API key needed): cover, author,
  first-published year, page count and subjects.
- **Three themes** — Paperback, Library and a Pulp throwback; pick per-browser.
- **Installable** — add it to your phone/desktop home screen (PWA).

---

## How it works

1. **Start a club** (you get a share code) or **join** with a friend's code.
2. **Add books** to the wheel — search by title or author and pick a result to
   pull in the cover, author, year and page count. Each is tagged with who added it.
3. The person **whose turn it is** (turn order = the order people joined) spins
   the wheel. Everyone watching sees the same spin.
4. The result becomes the **Book of the Month** with a **28-day deadline**
   (the spinner can change the date).
5. Each member **marks it read** and leaves a **private** half-star rating and
   review — nobody sees anyone else's review yet.
6. Once **everyone has read and rated**, all reviews **reveal at once**, the
   book moves to the **Ratings** tab, the turn passes, and the next spin
   unlocks. (The spinner can wrap up early if someone's behind.)
7. The **Stats** tab shows averages, most generous / harshest critic, top &
   most divisive books, reading habits, and more.

Prefer not to leave it to chance? The current spinner can open an **approval
vote** instead — everyone ticks the books they'd be happy to read, and the most
approved wins.

---

## One-time setup (~5–10 minutes)

StoryClub is a static site, so it needs a free **Firebase** project to store the
shared data. You only do this once. (The book metadata from Open Library needs
no setup or key — it just works.)

### 1. Create a Firebase project
1. Go to **<https://console.firebase.google.com>** and sign in with a Google account.
2. Click **Add project**, give it any name (e.g. `storyclub`), and continue.
   You can disable Google Analytics when asked.

### 2. Register a Web App and copy the config
1. On the project home, click the **Web icon `</>`** ("Add app").
2. Give it a nickname (e.g. `storyclub-web`) and click **Register app**.
   (You do **not** need Firebase Hosting.)
3. You'll see a `firebaseConfig` object like this — keep this tab open:
   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "storyclub-xxxx.firebaseapp.com",
     projectId: "storyclub-xxxx",
     storageBucket: "storyclub-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef…",
   };
   ```
   > These values are **safe to put in public code** — Firebase security is
   > enforced by the rules below, not by hiding these keys.

### 3. Create the Firestore database
1. In the left menu: **Build → Firestore Database → Create database**.
2. Choose a location near you and create it. (Production mode is fine — we set
   rules next.)

### 4. Publish the security rules
1. In Firestore, open the **Rules** tab.
2. Delete what's there and paste the entire contents of
   [`firestore.rules`](./firestore.rules), then click **Publish**.

These rules make each club **private to its members** (the Firebase uids that
have joined) — nobody can read, edit, or enumerate a club they haven't joined.

### 5. Turn on Anonymous sign-in
1. Left menu: **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab → **Add new provider** → **Anonymous** →
   enable it → **Save**.
   *(This signs everyone in invisibly so the rules work — there's still no login
   screen for your friends.)*
3. *(Optional)* For the **"Save your account"** button (keep your club across
   devices / a cleared browser), also add the **Email/Password** provider and,
   inside it, tick **Email link (passwordless sign-in)** → **Save**. Then add
   your live domain under **Authentication → Settings → Authorized domains**
   (e.g. `lewisf94.github.io`). Skip this and everything else still works; the
   button just won't send links.

### 6. Paste your config into the app
1. Open [`js/firebase.js`](./js/firebase.js).
2. Replace the placeholder `firebaseConfig` with the one you copied in step 2.
3. Save.

### 7. (Optional) Harden with App Check
Defense-in-depth so only your real site — not a script with your public API
key — can call Firebase. Skippable; the security rules are the real boundary.
See `recaptchaV3SiteKey` in [`js/firebase.js`](./js/firebase.js).

### 8. (Optional) Web push deadline reminders
A push notification as the read-by deadline nears, for members who opt in.
Skippable; everything works without it. Needs the **Blaze** plan (scheduled
Cloud Functions). Set `messagingVapidKey` in [`js/firebase.js`](./js/firebase.js)
and deploy the function in [`functions/`](./functions/README.md).

---

## Put it online with GitHub Pages

1. Commit and push these files to the **`main`** branch of your repository.
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick branch **`main`**, folder **`/ (root)`**, and **Save**.
5. After a minute your site is live at:
   **`https://lewisf94.github.io/storyclub/`**

Share that link (or the in-app club code) with your friends and you're set.

---

## Run it locally first (optional)

Because the app uses JavaScript modules, open it through a local web server
(not by double-clicking the file). With your Firebase config already filled in:

```bash
cd storyclub
python3 -m http.server 8000
# then open http://localhost:8000
```

Open a second browser/tab and join with the same code to see real-time sync and
test the spin together.

---

## Install it (PWA)

StoryClub ships a web manifest + service worker, so phones and desktops can
**install it to the home screen** (browser menu → *Install* / *Add to Home
Screen*) and it launches full-screen with an app icon. The shell is cached for
instant loads; live data still needs a connection (it's a realtime app). To
force clients onto fresh assets after a big change, bump `CACHE` in `sw.js`.

## Tech notes

- Plain HTML/CSS/JavaScript — **no build step**.
- Firebase Firestore (data) + Anonymous Auth (gates writes), loaded from the
  Firebase CDN.
- Data model lives under `groups/{code}` with `members`, `movies`, and
  `ratings` subcollections. (Those collection/field names are inherited from the
  film-club project StoryClub was adapted from — they're internal and never shown
  to readers; the "movies" docs hold books.)
- The wheel is canvas-drawn; the winner is chosen first and the easing always
  lands on it. The spinner broadcasts the spin so everyone animates the same
  result.

### Book covers & metadata (Open Library)
Built in and always on — no key, no account. As you type in the **Add a book**
box, StoryClub searches [Open Library](https://openlibrary.org) and shows
matching titles with covers; picking one stores the **author, year, page count
and subjects**, which show up on the cards and in **Stats → Reading habits**.
Tapping a book's cover or title opens a details popup (description, author,
Open Library rating, and a link to the work). "More like this" suggests other
books that share a subject.

You can also **import your Goodreads library**: on goodreads.com open
**My Books → Import and export → Export Library**, download the CSV, then use
**Import the CSV** on the Books tab and tick the books you want to add.

Book data and covers are from Open Library, a project of the Internet Archive.
