# 📦 Keeping Stock

A mobile-friendly web app to track toiletries and food inventory at home, optionally **synced across devices** in real time via a shared [Supabase](https://supabase.com) database. No build step — plain HTML/CSS/JavaScript, deployable to GitHub Pages.

Three pages, switched via the bottom tab bar, each with its own accent color:

- **Toiletries** (blue)
- **Food** (purple)
- **House** (green)

Each item shows its current count with **−** / **+** buttons to adjust it (the **−** button disables at 0 — counts never go negative). Between 0 and 1 the steppers pass through **½** — e.g. 1 → ½ → 0 — everywhere else they step by whole numbers. A red **❗** appears next to the name at ½ or 0. Tap an item's name to open **Edit item**, where you can rename it, set an optional **"Where is it?"** note (e.g. "hall closet, top shelf") shown as a small line under the name, move it to a different category, or delete it. Swipe a row to the right to delete it directly from the list — a brief **Undo** snackbar lets you reverse it for a few seconds. Use **+ Add item** at the bottom of a list to add something new — if the name already exists in that list (case-insensitive), the quantity you enter is just added to its existing count instead of creating a duplicate row.

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
  category text not null check (category in ('toiletries', 'food', 'house')),
  name text not null,
  count numeric not null default 0,
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

> **Migrating for the House category:** if your `items` table's `category` check constraint was created before House existed, widen it:
> ```sql
> alter table public.items drop constraint if exists items_category_check;
> alter table public.items add constraint items_category_check check (category in ('toiletries', 'food', 'house'));
> ```
> (If Postgres named your constraint something other than the default, find its real name first with `select conname from pg_constraint where conrelid = 'public.items'::regclass and contype = 'c';` and drop that instead.)

> **Migrating for half-quantities:** if your `items` table's `count` column was created as `integer`, widen it so it can hold `0.5`:
> ```sql
> alter table public.items alter column count type numeric using count::numeric;
> ```

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
| `index.html` | Header, three views (Toiletries/Food/House), bottom tab bar, add/edit modals, undo bar |
| `styles.css` | Per-category color themes, mobile-first styling |
| `app.js` | Supabase data access, real-time sync, localStorage fallback, rendering, actions |
| `config.js` | Supabase URL + anon key (blank = local-only mode) |
| `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png` | Home-screen install support |
