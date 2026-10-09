-- Cross-user authorization checks. Run in the Supabase SQL Editor AFTER creating 3 test users (A tenant, B owner, C admin).
-- Replace the UUIDs below. Each block should end with the stated result. Wrapped in a transaction and rolled back.
begin;
-- helper: act as a user
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true); set local role authenticated; end $$;

-- 1) Tenant cannot make themselves admin  -> EXPECT: ERROR role change not allowed
select pg_temp.as_user('00000000-0000-0000-0000-00000000000A');
update public.profiles set role='admin' where id='00000000-0000-0000-0000-00000000000A';

-- 2) Owner cannot self-verify -> EXPECT: verification stays 'none'
-- select pg_temp.as_user('...B...'); update public.listings set verification='verified' where owner_id='...B...'; select verification from public.listings;

-- 3) Tenant cannot read another user's visits/messages -> EXPECT: 0 rows
-- select count(*) from public.messages where conversation_id not in (select id from public.conversations where '...A...' in (user_a,user_b));

-- 4) Non-admin cannot call admin RPCs -> EXPECT: ERROR admin only
-- select public.admin_stats();

-- 5) Tenant cannot accept their own visit -> EXPECT: ERROR status change not allowed
rollback;
