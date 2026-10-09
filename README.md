# ROOMRAHI 2.0

Room / PG / hostel / house rental marketplace — mobile-first, Hindi + English, no build step.

**Stack:** static frontend (`index.html` + `cloud.js`) · Supabase (Auth, Postgres + RLS, Realtime) · Cloudflare R2 via a Worker (photos) · Cloudflare Worker + Gemini (optional AI). Firebase is **not** used in this version (Supabase covers auth, database and realtime chat so there is one security model, RLS).

## Two modes
- **Local mode** — `config.js` still has `YOUR_...` placeholders: everything works on one device (data in the browser). Good for trying the UI.
- **Cloud mode** — after you fill `config.js` and deploy per `docs/DEPLOYMENT.md`: login, shared listings, chat, notifications, admin, photos in R2, AI.

## What is implemented (and verified only by code review + syntax checks — not yet run against a live Supabase/Cloudflare project)
Tenant: Hinglish/voice search, filters, Near Me, workplace + shift field, ROOMRAHI Score, Trust, rent-vs-area check, real monthly cost, commute estimate, compare (3), favorites, saved searches (device only), visit + booking *requests* with status flow, report, share (WhatsApp/Telegram/copy link + `?room=<id>` deep link), roommate matching (opt-in), safety center.
Owner: dashboard, add/edit/delete, photos (compressed, perceptual hash for duplicate review), freshness confirm, rented/paused, accept/reject/reschedule requests, verification request, rent records, agreement draft (print/PDF), analytics (real counts), response-rate display.
Platform: Supabase Auth (email/password, optional Google, reset, session restore, logout-others, account deletion), RLS on every table, server-side admin RPCs + audit log, duplicate/suspicious-listing queue, realtime chat (text, photo, location, typing, online, read ticks, block, report, quick replies), notification center, PWA shell + offline banner, AI Worker with model fallback.

## User flow (browse first, login on action)
1. First open → popup: name + 10-digit mobile + location (typed, picked from areas that really have rooms, or "use my location").
2. Room list is filtered to that location (change anytime from the 📍 bar; "all places" available).
3. Browse, compare, save details freely. Tapping call / WhatsApp / chat / visit / booking asks for login — in cloud mode the real login screen (email+password, optional Google; name + mobile prefilled; the user returns to the same room after login). In local mode it is a clearly-labelled demo confirmation.
4. The mobile number is **not verified** (no OTP). Supabase phone-OTP needs an SMS provider (e.g. Twilio) and a small change in `cloud.js`; not included.

## Added in this round (works in local mode too; `features.js`)
Map view with price/verified markers + clustering + "search this area" + route links (OpenStreetMap/Leaflet, needs internet) · alerts for new matches on saved searches and favorite price drops (device-only, shown when the app is opened) · recommendations with the reason shown, learned on-device, clearable · search history · favorite collections (Best / Cheap / Near factory / Visit planned) · floor-wise units (vacant / occupied / soon) · 360° tour link (owner supplies a real https link) · nearby facilities from OpenStreetMap (labelled possibly incomplete) · shift-based leave-time advice · listing completeness + owner onboarding steps · short skippable tenant onboarding · draft autosave for the new-listing form · change history (rent/deposit/area/phone/status, this device/session) · move-in checklist + questions to ask the owner + private notes · scam check · rent-split calculator · manual dark/light theme.

## NOT implemented (be aware)
Real payments · legally valid e-signature · push notifications when the app is closed (needs a VAPID sender) · server-side alerts (current alerts only appear when the app is opened) · newly-verified alerts · image thumbnails/variants · per-photo room-section tags · server-side change history · per-property SEO/Open Graph (needs server rendering) · bundler/modules/TypeScript · automated UI tests (a smoke script exists only in the build environment).

## Quick start
1. Create Supabase project → run `supabase/schema.sql`.
2. Deploy both Workers (`workers/`), set secrets.
3. Fill `config.js`, host the folder (Cloudflare Pages / Netlify).
4. Sign up, then make yourself admin with the SQL at the bottom of `schema.sql`.
Full steps: `docs/DEPLOYMENT.md`.

## FIRST: security
The old ROOMRAHI.zip contained a Cloudflare token in a plain file. **Revoke/rotate it in the Cloudflare dashboard now** and delete the file from every copy, repo and backup. This project contains no secrets and needs none beyond Worker secrets (`GEMINI_API_KEY`).
