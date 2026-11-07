# 📦 Keeping Stock

A mobile-friendly web app to track toiletries and food inventory at home, optionally **shared and synced across phones** in real time through Firebase (Google's free tier). No build step — plain HTML/CSS/JavaScript, deployable to GitHub Pages.

Three pages, switched via the bottom tab bar, each with its own accent color:

- **Toiletries** (blue)
- **Food** (purple)
- **House** (green)

Each item shows its current count with **−** / **+** buttons to adjust it (the **−** button disables at 0 — counts never go negative). Between 0 and 1 the steppers pass through **½** — e.g. 1 → ½ → 0 — everywhere else they step by whole numbers. A red **❗** appears next to the name at ½ or 0. Tap an item's name to open **Edit item**, where you can rename it, set an optional **"Where is it?"** note (e.g. "hall closet, top shelf") shown as a small line under the name, move it to a different category, or delete it. Swipe a row to the right to delete it directly from the list — a brief **Undo** snackbar lets you reverse it for a few seconds. Use **+ Add item** at the bottom of a list to add something new — if the name already exists in that list (case-insensitive), the quantity you enter is just added to its existing count instead of creating a duplicate row.

## Moving to a new phone (Backup & restore)

In local-only mode your list lives in the browser on that one device, so a new phone starts with just the starting items. To carry your list over, open **Backup & restore** (the small link at the bottom of the page) on the old phone and tap **Copy** (or **Share…**), send that text to yourself, then on the new phone open **Backup & restore**, paste it under **Restore from a backup**, and tap **Restore**. Restore replaces what's on that device. (If you use a shared list — see below — your list lives in the cloud and none of this is needed.)

## Starting items

**Toiletries:** Aquafresh (10), Tom's of Maine (1), Negev's toothpaste (3), Necca 7 (44), Toilet paper (1), Noam's deodorant (7), Tamar's deodorant (8)

**Food:** BBQ Sauce (6), Olive oil (1), Pine nuts (1), Sugar (1), Flour (1), Paper Towels (2)

These are seeded automatically the first time the app runs on a phone that has no list yet.

## Sharing a list between phones

By default the list lives **only in that phone's browser** (local mode). The ☁️ button in the header turns on a **shared list**:

- **Create shared list** uploads this phone's current list and gives you an 8-character code. **Invite** sends the code (and how to use it) through whatever share sheet you pick.
- On the other phone, tap ☁️ → **Join** and enter the code. Both phones then show the same list, and changes appear on the other phone within moments.
- **Stop syncing on this phone** returns it to a local list (it keeps a copy of what it was showing); the shared list stays online for everyone else.
- The ☁️ button turns a solid color with a green ✓ when a phone is using a shared list; a plain white circle means the list is only on that phone.
- **Backup & restore** is for a list that lives on one phone. On a shared list the link becomes **Back up list** (copy only) — Restore isn't offered there, so nobody can accidentally overwrite everyone's list.

### How it's stored

Firebase (Firestore + Anonymous Auth, loaded from Google's CDN — no build step), in the **same Firebase project as Showtime**. Each shared list is one document, `families/{code}`, with the items as a map on it (`stock.<itemId> = {category, name, count, notes}`). Edits merge a single item at a time, so two phones changing different items never overwrite each other; changing the *same* item at the same moment is last-write-wins.

Why a map on the family document instead of a subcollection of per-item documents? That project's Firestore security rules only open `tickets` beneath a family, and a field on the family document itself needs no rule changes. If the rules ever allow it, a `stock` subcollection would be the more conventional layout.

- `config.js` holds the Firebase web settings (the same public values Showtime uses). They identify the project and are not secrets — access is decided by the Firestore security rules.
- The Firebase SDK version in `index.html` (10.14.1) matches Showtime's on purpose: both apps live on the same GitHub Pages origin and so share the same browser-side Firestore cache.
- Showtime's family codes also work here (and vice versa a Keeping Stock code just shows an empty Showtime list), since both use `families/{code}`.

### Security rules (live in the Firebase console, shared with Showtime)

A shared list is protected by an unguessable 8-character code, like an unlisted link: a signed-in client can look a family up *by its code* but cannot browse the list of families or the folders of files. These rules are not stored in any repo, so here is what is currently published (Firebase console → Firestore Database → Rules, and Storage → Rules):

```
// Firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyCode} {
      allow get, write: if request.auth != null;
      match /tickets/{ticketId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}

// Storage
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /families/{familyCode}/{allPaths=**} {
      allow get, write: if request.auth != null;
    }
  }
}
```

(Before 2026-11-07 these said `allow read, write`, which also allowed *listing* every family — and every family's files — to anyone signed in. Changing `read` to `get` closed that. A shared list still isn't private from anyone who is given or guesses the code.)

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Create a new GitHub repo and push this folder to it.
2. In the repo's **Settings → Pages**, set the source to the `main` branch, root folder.
3. The `.nojekyll` file is already included so GitHub Pages serves the files as-is.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Header, three views (Toiletries/Food/House), bottom tab bar, add/edit modals, undo bar |
| `styles.css` | Per-category color themes, mobile-first styling |
| `app.js` | Local storage + Firebase shared-list sync, rendering, actions, backup & restore |
| `config.js` | Firebase web settings for the shared list |
| `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png` | Home-screen install support |
