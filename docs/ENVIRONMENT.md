# Environment
Public (config.js): SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_WORKER_URL, AI_WORKER_URL, R2_PUBLIC_URL, PAGE_SIZE, FLAGS.
Worker vars (wrangler.*.toml): SUPABASE_URL, SUPABASE_ANON_KEY, R2_PUBLIC_URL, ALLOWED_ORIGIN (comma-separated exact origins). Optional KV binding `RATE_KV`.
Worker secret: GEMINI_API_KEY. Local dev: put it in `.dev.vars` (git-ignored). `.env.example` has placeholders only.
