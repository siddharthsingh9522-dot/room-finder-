# Testing
Automated: `tests/smoke.mjs` (Workers reject unauthenticated calls), `tests/rls_checks.sql` (cross-user authorization — fill in the UUIDs).
Manual regression checklist (run after every change, on a real phone):
- Auth: sign up, confirm email, login, reload (session restored), logout, reset password, delete account.
- Listings: add with 3 photos, edit, mark rented/paused, delete (photos removed from R2), verified badge only after admin verify.
- Search: Hindi/Hinglish query, filters, Near Me (permission prompt explains why), compare 2–3.
- Chat (two accounts): send text/photo/location, typing, online, read ✓✓, block stops messages, report creates a row.
- Visit/booking: tenant requests → owner accepts/reschedules/rejects → statuses + notifications; tenant cannot self-accept.
- Rent/agreement: owner creates record + agreement; tenant sees reminder and accepts; owner "मिल गया".
- Admin: stats, suspicious queue, verify/suspend/remove, audit log row appears; non-admin gets "admin only".
- Security: tenant cannot read others' messages/visits; direct DELETE on another user's R2 key → 403; upload non-image → 415.
- PWA: install, airplane mode shows offline banner + cached shell.
- Mobile: no horizontal scroll at 320 px, buttons ≥44 px, dark mode.
