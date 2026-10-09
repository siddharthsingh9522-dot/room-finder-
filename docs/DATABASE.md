# Database
Tables: profiles, listings, listing_photos, favorites, saved_searches (table only; UI keeps them on-device), visits, bookings, conversations, messages, blocks, reports, notifications, rent_records, agreements, events, audit_logs. Views: public_profiles, roommate_candidates. RPC: mark_read, owner_response, admin_stats, admin_listing_action, admin_resolve_report, admin_set_banned, suspicious_listings, duplicate_photo_pairs, delete_my_account, rent_reminders (optional cron).
Not created (not needed yet): payments, reviews, recommendations (no fabricated data).
**Backup/restore:** Supabase → Database → Backups (daily; use PITR on paid plans). Before any migration: `pg_dump` the DB, test the migration on a copy, keep a rollback SQL next to it. R2: enable bucket versioning/lifecycle or periodically `rclone sync` to another bucket.
**Credential rotation:** rotate Supabase keys in Settings → API, then update Worker vars and `config.js`; rotate `GEMINI_API_KEY` with `wrangler secret put`.
**Incident response:** revoke exposed credential → check audit/access logs → ban abusers (`admin_set_banned`) → notify affected users if personal data was exposed → write a post-mortem.
