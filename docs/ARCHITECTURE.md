# Architecture
```
Browser (index.html, cloud.js, sw.js)
  ├─ Supabase JS ──► Auth · Postgres (RLS) · Realtime (messages, notifications)
  ├─ storage-worker ─► R2 bucket binding   (verifies Supabase token, magic-byte check, path rules)
  └─ ai-worker ─────► Gemini (model fallback; receives only small facts)
```
- **index.html** — the whole UI (tenant/owner), works alone in local mode. Exposes a small `window.RR` interface.
- **features.js** — local/cloud feature layer (map, alerts, recommendations, units, checklist, etc.). Core exposes registries on `window.RR` (`acts`, `extras`, `views`, `slots`, `hooks`, `after`) so modules plug in without editing the core.
- **cloud.js** — only active with real config. It mirrors local state to Supabase by diffing on every `save()` (rooms, photos, favorites, visits, bookings, reports, role), pulls on login, and adds chat, notifications, admin, rent, agreement, roommate, analytics, AI.
- **Trust model** — the browser is untrusted. Roles, ownership, status transitions, verification and bans are enforced in Postgres (RLS + triggers) and Workers. Admin UI only calls RPCs that re-check `is_admin()`.
- **Scoring** (Score/Trust/price check/total cost) is computed in the browser from listing data and labelled as estimates; no reviews or scores are invented. The price check needs ≥3 other listings in the same area, otherwise it says data is insufficient.
- **Freshness** — Active (<15 days since confirmation) → Needs confirmation (15–30) → Expired (>30); rented/paused/suspended are separate states. Older ones rank lower.
- **Known debt** — single large HTML file (no modules/build), sync is diff-based (last write wins), `cloud.js` is dense. Next refactor: split into modules + add a bundler + typed API layer.
