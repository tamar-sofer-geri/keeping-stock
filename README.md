# 📦 Keeping Stock

A mobile-friendly web app to track toiletries and food inventory at home, optionally **synced across devices** in real time via a shared [Supabase](https://supabase.com) database. No build step — plain HTML/CSS/JavaScript, deployable to GitHub Pages.

Two pages, switched via the bottom tab bar, each with its own accent color:

- **Toiletries** (blue)
- **Food** (purple)

Each item shows its current count with **−** / **+** buttons to adjust it (the **−** button disables at 0 — counts never go negative). Tap an item's name to open **Edit item**, where you can rename it and set an optional **"Where is it?"** note (e.g. "hall closet, top shelf") shown as a small line under the name. Tap the 🗑️ to remove an item entirely. Use **+ Add item** at the bottom of a list to add something new — if the name already exists in that list (case-insensitive), the quantity you enter is just added to its existing count instead of creating a duplicate row.

## Starting items

**Toiletries:** Aquafresh (10), Tom's of Maine (1), Negev's toothpaste (3), Necca 7 (44), Toilet paper (1), Noam's deodorant (7), Tamar's deodorant (8)

**Food:** BBQ Sauce (6), Olive oil (1), Pine nuts (1), Sugar (1), Flour (1), Paper Towels (2)

These are seeded automatically the first time the app runs — in local-only mode via `localStorage`, or in Supabase mode via the app itself if the `items` table is empty on first load. No manual insert needed.

## Configuration

Backend connection lives in `config.js`:

```js
window.HOMESTOCK_CONFIG = {
  supabaseUrl: "https://<project>.supabase.co",
  supabaseAnonKey: "<anon public key>"
};
```

Leave both blank to run in **local-only mode** (this device only, no sync — the default as shipped).

### Database schema

To enable multi-device sync, create a Supabase project and run this once in its SQL editor:

```sql
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('toiletries', 'food')),
  name text not null,
  count integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now()
);
alter table public.items enable row level security;
create policy "public read"   on public.items for select using (true);
create policy "public insert" on public.items for insert with check (true);
create policy "public update" on public.items for update using (true) with check (true);
create policy "public delete" on public.items for delete using (true);
alter publication supabase_realtime add table public.items;
```

Then paste the project's URL and anon key into `config.js`. The app will seed the starting items into the empty table automatically on first load.

> Access is currently **open** (anyone with the app can read/write). To lock it down later, tighten these policies or add Supabase Auth.

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
| `index.html` | Header, two views (Toiletries/Food), bottom tab bar, add/rename modals |
| `styles.css` | Green theme, mobile-first styling |
| `app.js` | Supabase data access, real-time sync, localStorage fallback, rendering, actions |
| `config.js` | Supabase URL + anon key (blank = local-only mode) |
| `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png` | Home-screen install support |
