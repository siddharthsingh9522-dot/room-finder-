# API
All Worker calls need `Authorization: Bearer <Supabase access token>`.
**storage-worker** — `PUT /upload?folder=listings|profiles|chat` (raw image) → `{url,key}` · `DELETE /object?key=` · `DELETE /mine` (all your objects).
**ai-worker** — `POST /` `{task:'parse'|'compare'|'describe'|'support', payload}` → `{text,model}`. Errors: 401, 413, 429, 503. Models are discovered via Gemini ListModels (flash → flash-lite → pro) and skipped for 60 s on 429.
**Supabase** — tables via PostgREST under RLS; RPCs listed in DATABASE.md; Realtime channels: `notif-<uid>`, `chat-<conversationId>` (postgres changes + typing broadcast + presence).
