// ROOMRAHI public configuration. Everything here is PUBLIC by design (it ships to the browser).
// NEVER put secrets here: no service_role key, no R2 keys, no Gemini key. Those live only in Supabase / Cloudflare Worker secrets.
window.ROOMRAHI_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_PUBLIC_KEY',   // anon key is public; safety comes from RLS in supabase/schema.sql
  STORAGE_WORKER_URL: 'https://roomrahi-storage.YOUR_SUBDOMAIN.workers.dev',
  AI_WORKER_URL: 'https://roomrahi-ai.YOUR_SUBDOMAIN.workers.dev',
  R2_PUBLIC_URL: 'https://photos.yourdomain.com',        // public base URL of the R2 bucket (custom domain or r2.dev)
  PAGE_SIZE: 150,
  // Feature flags — turn risky modules off without touching code
  FLAGS: { AI_SEARCH: true, AI_COMPARE: true, AI_DESCRIBE: true, AGREEMENT: true, RENT: true, ROOMMATE: true, ANALYTICS: true, GOOGLE_LOGIN: false, VIRTUAL_TOUR: true }
};
