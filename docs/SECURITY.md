# Security
**Secrets:** none in the repo. Public: Supabase URL + anon key (safe because of RLS). Secret: `GEMINI_API_KEY` (Worker secret). R2 uses a bucket *binding*, so there are no R2 access keys at all. Never use the Supabase `service_role` key in the frontend.
**Incident from the old project:** a Cloudflare token was stored in a plain file in the ZIP → revoke it, check Cloudflare audit logs for misuse, remove from all copies/git history.
**Authorization (server-side):**
- RLS on every table (`supabase/schema.sql`). Public: only `state='active'` listings and their photos. Tenants: own favorites/requests/chats/reports. Owners: own listings/photos/leads. Admin: via `is_admin()` (role stored in `profiles`, only changeable by SQL; trigger blocks self-promotion and un-banning).
- Triggers: owners cannot self-verify or un-suspend; changing rent/area/GPS on a verified listing re-opens review; visit/booking status changes are validated per actor; no payment columns exist.
- Admin actions are RPCs (`admin_listing_action`, `admin_resolve_report`, `admin_set_banned`) that write `audit_logs` (actor, target, action, result, time; no secrets).
**Uploads:** Worker verifies the Supabase token + not banned, size ≤1.5 MB, magic bytes (jpeg/png/webp only), writes only to `listings|profiles|chat/<userId>/<uuid>.<ext>`, delete needs strict key regex + ownership (admin any), optional per-user rate limit (KV).
**AI:** token required, rate-limited, input ≤4 KB, fixed system prompts, outputs are suggestions; listing text is editable before saving; parsed filters only drive a real database search.
**XSS:** all user text is escaped (`esc`); chat images only render from your R2 domain.
**Payments:** not implemented. If added later: server-side provider session, idempotency keys, webhook signature verification, never trust client "paid" flags.
**Limits:** supabase views `public_profiles`/`roommate_candidates` intentionally bypass RLS to expose only name/photo/opted-in preferences. Set `ALLOWED_ORIGIN` to your real domain. Turn on Supabase email confirmation, leaked-password protection and CAPTCHA/rate limits in the dashboard.
