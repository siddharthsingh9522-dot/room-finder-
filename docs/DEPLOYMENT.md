# Deployment
1. **Supabase:** new project → SQL Editor → paste `supabase/schema.sql` → Run. Auth → Providers: enable Email (turn on email confirmation); Google optional. Auth → URL config: add your site URL + redirect. Database → Replication: confirm `messages`, `notifications` are in `supabase_realtime`.
2. **R2:** create bucket `roomrahi-photos`; attach a custom domain (or r2.dev for testing) → that is `R2_PUBLIC_URL`.
3. **Workers:** `cd workers`; edit both `wrangler.*.toml` (URLs, ALLOWED_ORIGIN, anon key); `npx wrangler deploy --config wrangler.storage.toml`; `npx wrangler secret put GEMINI_API_KEY --config wrangler.ai.toml`; `npx wrangler deploy --config wrangler.ai.toml`. Optional: create a KV namespace and bind it as `RATE_KV`.
4. **Frontend:** fill `config.js`; deploy the project root (excluding `workers/`, `supabase/`, `docs/`, `tests/` if you like) to Cloudflare Pages/Netlify over HTTPS (needed for PWA, GPS, voice).
5. **Admin:** sign up in the app, then run the `update public.profiles set role='admin' ...` line from `schema.sql`.
6. **Verify:** `STORAGE=<url> AI=<url> node tests/smoke.mjs`, then walk `docs/TESTING.md`.
**Rollback:** redeploy the previous Pages build / `wrangler rollback`; DB: restore the backup taken before migration.
**Push when app is closed:** not included. Needs Web Push (VAPID) + a sender (e.g. Supabase Edge Function on `notifications` inserts) + `push` handler in `sw.js`.
