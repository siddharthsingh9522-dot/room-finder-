-- ROOMRAHI 2.0 — Supabase schema + RLS.
-- Run once in the Supabase SQL Editor on a NEW project (or take a backup first). See docs/DATABASE.md.
create extension if not exists pgcrypto;

-- ---------- profiles & helpers ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text, phone text, photo_url text,
  role text not null default 'tenant' check (role in ('tenant','owner','admin')),
  prefs jsonb not null default '{}'::jsonb,
  roommate_opt_in boolean not null default false,
  roommate jsonb not null default '{}'::jsonb,
  banned boolean not null default false,
  created_at timestamptz not null default now());

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin' and not banned) $$;
create or replace function public.is_banned() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select banned from profiles where id=auth.uid()),false) $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,name,phone,role) values (new.id, coalesce(nullif(left(new.raw_user_meta_data->>'name',80),''), split_part(new.email,'@',1)), nullif(left(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'\D','','g'),10),''),
    case when new.raw_user_meta_data->>'role'='owner' then 'owner' else 'tenant' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- users may switch tenant<->owner, but never become/lose admin or unban themselves
create or replace function public.protect_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role and (new.role='admin' or old.role='admin') then raise exception 'role change not allowed'; end if;
    new.banned := old.banned;
  end if;
  return new;
end $$;
create trigger trg_protect_profile before update on public.profiles for each row execute function public.protect_profile();

alter table public.profiles enable row level security;
create policy profiles_self_select on profiles for select using (id=auth.uid() or is_admin());
create policy profiles_self_update on profiles for update using (id=auth.uid() or is_admin()) with check (id=auth.uid() or is_admin());

create view public.public_profiles as select id, name, photo_url from public.profiles where not banned;
grant select on public.public_profiles to authenticated;
create view public.roommate_candidates as select id, split_part(coalesce(name,''),' ',1) as name, roommate from public.profiles where roommate_opt_in and not banned;
grant select on public.roommate_candidates to authenticated;

-- ---------- listings ----------
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  type text not null default 'room' check (type in ('room','pg','rk','house','shared')),
  rent int not null check (rent between 500 and 500000),
  deposit int not null default 0 check (deposit >= 0),
  area text not null, city text not null default '', phone text not null default '',
  beds int not null default 0, amenities text[] not null default '{}', suitable text not null default '',
  food_included boolean not null default false, elec_included boolean not null default false,
  description text not null default '' check (char_length(description) <= 2000),
  lat double precision, lng double precision, tour_url text check (tour_url is null or tour_url ~ '^https://'),
  units jsonb not null default '[]'::jsonb check (jsonb_typeof(units)='array' and jsonb_array_length(units)<=60),
  state text not null default 'active' check (state in ('active','rented','paused','suspended')),
  verification text not null default 'none' check (verification in ('none','pending','verified','rejected')),
  admin_note text,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index on listings(state, city, area); create index on listings(owner_id); create index on listings(rent); create index on listings(confirmed_at desc);

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings on delete cascade,
  url text not null, key text, phash text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
  tag text check (tag is null or tag in ('bedroom','bathroom','kitchen','balcony','outside','other')),
  position int not null default 0);
create index on listing_photos(listing_id); create index on listing_photos(phash);

-- non-admins cannot self-verify, un-suspend, or suspend; sensitive edits on a verified listing re-open review
create or replace function public.protect_listing() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at := now();
  if tg_op='INSERT' then
    if not is_admin() then new.verification:='none'; new.admin_note:=null; if new.state='suspended' then new.state:='active'; end if; end if;
  elsif not is_admin() then
    new.admin_note := old.admin_note;
    if old.state='suspended' then new.state:='suspended'; elsif new.state='suspended' then new.state:=old.state; end if;
    if new.verification is distinct from old.verification and not (new.verification='pending' and old.verification in ('none','rejected')) then new.verification:=old.verification; end if;
    if (new.rent,new.area,new.lat,new.lng) is distinct from (old.rent,old.area,old.lat,old.lng) and old.verification='verified' then new.verification:='pending'; end if;
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
create trigger trg_protect_listing before insert or update on public.listings for each row execute function public.protect_listing();

alter table listings enable row level security; alter table listing_photos enable row level security;
create policy listings_read on listings for select using (state='active' or owner_id=auth.uid() or is_admin());
create policy listings_ins on listings for insert to authenticated with check (owner_id=auth.uid() and not is_banned() and exists(select 1 from profiles where id=auth.uid() and role in ('owner','admin')));
create policy listings_upd on listings for update to authenticated using (owner_id=auth.uid() or is_admin()) with check (owner_id=auth.uid() or is_admin());
create policy listings_del on listings for delete to authenticated using (owner_id=auth.uid() or is_admin());
create policy photos_read on listing_photos for select using (exists(select 1 from listings l where l.id=listing_id));
create policy photos_write on listing_photos for all to authenticated using (exists(select 1 from listings l where l.id=listing_id and (l.owner_id=auth.uid() or is_admin()))) with check (exists(select 1 from listings l where l.id=listing_id and (l.owner_id=auth.uid() or is_admin())));

-- ---------- favorites / saved searches ----------
create table public.favorites (user_id uuid not null default auth.uid() references auth.users on delete cascade, listing_id uuid not null references listings on delete cascade, collection text not null default 'saved', created_at timestamptz not null default now(), primary key(user_id,listing_id));
create table public.saved_searches (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, label text, filters jsonb not null, created_at timestamptz not null default now());
alter table favorites enable row level security; alter table saved_searches enable row level security;
create policy fav_own on favorites for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy ss_own on saved_searches for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- ---------- visits & bookings (REQUESTED/ACCEPTED/REJECTED/RESCHEDULED/CONFIRMED/CANCELLED/COMPLETED) ----------
create table public.visits (id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings on delete cascade, tenant_id uuid not null default auth.uid() references auth.users on delete cascade, owner_id uuid not null references auth.users on delete cascade, when_text text not null, note text not null default '', status text not null default 'REQUESTED' check (status in ('REQUESTED','ACCEPTED','REJECTED','RESCHEDULED','CONFIRMED','CANCELLED','COMPLETED')), created_at timestamptz not null default now());
create table public.bookings (id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings on delete cascade, tenant_id uuid not null default auth.uid() references auth.users on delete cascade, owner_id uuid not null references auth.users on delete cascade, move_in text not null default '', note text not null default '', status text not null default 'REQUESTED' check (status in ('REQUESTED','ACCEPTED','REJECTED','RESCHEDULED','CONFIRMED','CANCELLED','COMPLETED')), created_at timestamptz not null default now());
create index on visits(tenant_id); create index on visits(owner_id); create index on bookings(tenant_id); create index on bookings(owner_id);
-- NOTE: no payment columns on purpose. Real payments need a secure payment backend + webhook verification (see docs/SECURITY.md).

create or replace function public.req_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    select owner_id into new.owner_id from listings where id=new.listing_id and state='active';
    if new.owner_id is null then raise exception 'listing not available'; end if;
    if new.owner_id=auth.uid() then raise exception 'cannot request own listing'; end if;
    new.tenant_id:=auth.uid(); new.status:='REQUESTED'; return new;
  end if;
  if (new.listing_id,new.tenant_id,new.owner_id) is distinct from (old.listing_id,old.tenant_id,old.owner_id) then raise exception 'immutable'; end if;
  if is_admin() or new.status=old.status then return new; end if;
  if auth.uid()=old.tenant_id then
    if new.status='CANCELLED' and old.status not in ('COMPLETED','REJECTED') then return new; end if;
    if new.status='CONFIRMED' and old.status='ACCEPTED' and tg_table_name='bookings' then return new; end if;
  elsif auth.uid()=old.owner_id then
    if new.status in ('ACCEPTED','REJECTED','RESCHEDULED','COMPLETED') then return new; end if;
  end if;
  raise exception 'status change not allowed';
end $$;
create trigger trg_visit_guard before insert or update on visits for each row execute function public.req_guard();
create trigger trg_booking_guard before insert or update on bookings for each row execute function public.req_guard();
alter table visits enable row level security; alter table bookings enable row level security;
create policy v_sel on visits for select to authenticated using (tenant_id=auth.uid() or owner_id=auth.uid() or is_admin());
create policy v_ins on visits for insert to authenticated with check (tenant_id=auth.uid() and not is_banned());
create policy v_upd on visits for update to authenticated using (tenant_id=auth.uid() or owner_id=auth.uid() or is_admin());
create policy b_sel on bookings for select to authenticated using (tenant_id=auth.uid() or owner_id=auth.uid() or is_admin());
create policy b_ins on bookings for insert to authenticated with check (tenant_id=auth.uid() and not is_banned());
create policy b_upd on bookings for update to authenticated using (tenant_id=auth.uid() or owner_id=auth.uid() or is_admin());

-- ---------- chat ----------
create table public.conversations (id uuid primary key default gen_random_uuid(), listing_id uuid references listings on delete set null, user_a uuid not null default auth.uid() references auth.users on delete cascade, user_b uuid not null references auth.users on delete cascade, created_at timestamptz not null default now(), check (user_a<>user_b));
create unique index conv_uniq on conversations(coalesce(listing_id,'00000000-0000-0000-0000-000000000000'::uuid), least(user_a,user_b), greatest(user_a,user_b));
create table public.messages (id bigint generated always as identity primary key, conversation_id uuid not null references conversations on delete cascade, sender_id uuid not null default auth.uid() references auth.users on delete cascade, kind text not null default 'text' check (kind in ('text','image','location','listing')), body text not null check (char_length(body) between 1 and 2000), created_at timestamptz not null default now(), read_at timestamptz);
create index on messages(conversation_id, created_at);
create table public.blocks (blocker_id uuid not null default auth.uid() references auth.users on delete cascade, blocked_id uuid not null references auth.users on delete cascade, primary key(blocker_id,blocked_id));
create or replace function public.in_conv(c uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from conversations where id=c and auth.uid() in (user_a,user_b)) $$;
create or replace function public.chat_blocked(c uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from conversations v join blocks b on (b.blocker_id=v.user_a and b.blocked_id=v.user_b) or (b.blocker_id=v.user_b and b.blocked_id=v.user_a) where v.id=c) $$;
create or replace function public.mark_read(c uuid) returns void language sql security definer set search_path=public as $$ update messages set read_at=now() where conversation_id=c and sender_id<>auth.uid() and read_at is null and in_conv(c) $$;
alter table conversations enable row level security; alter table messages enable row level security; alter table blocks enable row level security;
create policy c_sel on conversations for select to authenticated using (auth.uid() in (user_a,user_b) or is_admin());
create policy c_ins on conversations for insert to authenticated with check (user_a=auth.uid() and not is_banned());
create policy m_sel on messages for select to authenticated using (in_conv(conversation_id) or is_admin());
create policy m_ins on messages for insert to authenticated with check (sender_id=auth.uid() and in_conv(conversation_id) and not chat_blocked(conversation_id) and not is_banned());
create policy blk_own on blocks for all to authenticated using (blocker_id=auth.uid()) with check (blocker_id=auth.uid());

-- ---------- reports ----------
create table public.reports (id uuid primary key default gen_random_uuid(), listing_id uuid references listings on delete cascade, target_user uuid references auth.users on delete cascade, reporter_id uuid not null default auth.uid() references auth.users on delete cascade, reason text not null, status text not null default 'open' check (status in ('open','dismissed','actioned')), resolution text, created_at timestamptz not null default now());
alter table reports enable row level security;
create policy r_ins on reports for insert to authenticated with check (reporter_id=auth.uid() and not is_banned());
create policy r_sel on reports for select to authenticated using (reporter_id=auth.uid() or is_admin());

-- ---------- notifications ----------
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, kind text not null, title text not null, body text not null default '', ref text, read boolean not null default false, created_at timestamptz not null default now());
create index on notifications(user_id, created_at desc);
alter table notifications enable row level security;
create policy n_sel on notifications for select to authenticated using (user_id=auth.uid());
create policy n_upd on notifications for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke update on notifications from authenticated; grant update(read) on notifications to authenticated;
create or replace function public.notify(u uuid, k text, t text, b text, r text) returns void language sql security definer set search_path=public as $$ insert into notifications(user_id,kind,title,body,ref) values(u,k,t,b,r) $$;
revoke all on function public.notify(uuid,text,text,text,text) from public, anon, authenticated;

create or replace function public.trg_notify_req() returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; lab text := case when tg_table_name='visits' then 'विज़िट' else 'बुकिंग' end;
begin
  select name into nm from listings where id=new.listing_id;
  if tg_op='INSERT' then perform notify(new.owner_id,tg_table_name,'नई '||lab||' रिक्वेस्ट',coalesce(nm,''),new.id::text);
  elsif new.status is distinct from old.status then
    if auth.uid()=new.tenant_id then perform notify(new.owner_id,tg_table_name,lab||' '||new.status,coalesce(nm,''),new.id::text);
    else perform notify(new.tenant_id,tg_table_name,lab||' '||new.status,coalesce(nm,''),new.id::text); end if;
  end if; return new; end $$;
create trigger n_visit after insert or update on visits for each row execute function public.trg_notify_req();
create trigger n_booking after insert or update on bookings for each row execute function public.trg_notify_req();
create or replace function public.trg_notify_msg() returns trigger language plpgsql security definer set search_path=public as $$
declare peer uuid;
begin select case when user_a=new.sender_id then user_b else user_a end into peer from conversations where id=new.conversation_id;
  perform notify(peer,'message','नया संदेश',case when new.kind='text' then left(new.body,80) else 'संदेश' end,new.conversation_id::text); return new; end $$;
create trigger n_msg after insert on messages for each row execute function public.trg_notify_msg();

-- ---------- rent & agreements (no fake payment status: owner confirms what they actually received) ----------
create table public.rent_records (id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings on delete cascade, owner_id uuid not null references auth.users on delete cascade, tenant_id uuid not null references auth.users on delete cascade, month text not null check (month ~ '^\d{4}-\d{2}$'), amount int not null check (amount>0), paid_amount int not null default 0, due_date date not null, status text not null default 'PENDING' check (status in ('PENDING','PAID','OVERDUE','PARTIAL','CANCELLED')), created_at timestamptz not null default now(), unique(listing_id,tenant_id,month));
create table public.agreements (id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings on delete cascade, booking_id uuid references bookings on delete set null, owner_id uuid not null references auth.users on delete cascade, tenant_id uuid not null references auth.users on delete cascade, terms jsonb not null, status text not null default 'SENT' check (status in ('DRAFT','SENT','ACCEPTED_BY_TENANT')), created_at timestamptz not null default now());
alter table rent_records enable row level security; alter table agreements enable row level security;
create policy rr_sel on rent_records for select to authenticated using (owner_id=auth.uid() or tenant_id=auth.uid() or is_admin());
create policy rr_ins on rent_records for insert to authenticated with check (owner_id=auth.uid() and exists(select 1 from bookings b where b.listing_id=rent_records.listing_id and b.tenant_id=rent_records.tenant_id and b.owner_id=auth.uid() and b.status in ('ACCEPTED','CONFIRMED','COMPLETED')));
create policy rr_upd on rent_records for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy ag_sel on agreements for select to authenticated using (owner_id=auth.uid() or tenant_id=auth.uid() or is_admin());
create policy ag_ins on agreements for insert to authenticated with check (owner_id=auth.uid() and exists(select 1 from bookings b where b.listing_id=agreements.listing_id and b.tenant_id=agreements.tenant_id and b.owner_id=auth.uid() and b.status in ('ACCEPTED','CONFIRMED','COMPLETED')));
create policy ag_upd on agreements for update to authenticated using (tenant_id=auth.uid()) with check (tenant_id=auth.uid() and status='ACCEPTED_BY_TENANT');
revoke update on agreements from authenticated; grant update(status) on agreements to authenticated;
create or replace function public.trg_notify_rent() returns trigger language plpgsql security definer set search_path=public as $$
begin if tg_op='INSERT' then perform notify(new.tenant_id,'rent','किराया दर्ज हुआ',new.month||' — ₹'||new.amount,new.id::text);
 elsif new.status is distinct from old.status then perform notify(new.tenant_id,'rent','किराया '||new.status,new.month||' — ₹'||new.amount,new.id::text); end if; return new; end $$;
create trigger n_rent after insert or update on rent_records for each row execute function public.trg_notify_rent();
-- Daily reminders. Enable the pg_cron extension in Supabase, then uncomment the schedule line.
create or replace function public.rent_reminders() returns void language plpgsql security definer set search_path=public as $$
begin
  update rent_records set status='OVERDUE' where status='PENDING' and due_date<current_date;
  insert into notifications(user_id,kind,title,body,ref) select tenant_id,'rent','किराया जल्द देय',month||' — ₹'||amount,id::text from rent_records where status in ('PENDING','PARTIAL') and due_date=current_date+3;
end $$;
revoke all on function public.rent_reminders() from public, anon, authenticated;
-- select cron.schedule('rr-rent','30 3 * * *','select public.rent_reminders()');

-- ---------- analytics (privacy-conscious: only event kind + listing; no IP/device) ----------
create table public.events (id bigint generated always as identity primary key, user_id uuid default auth.uid(), kind text not null check (kind in ('search','view','favorite','contact','visit','booking','chat')), listing_id uuid references listings on delete cascade, created_at timestamptz not null default now());
create index on events(listing_id, kind, created_at);
alter table events enable row level security;
create policy ev_ins on events for insert to authenticated with check (user_id=auth.uid());
create policy ev_sel on events for select to authenticated using (is_admin() or exists(select 1 from listings l where l.id=listing_id and l.owner_id=auth.uid()));
-- owner response rate / median first-reply time (aggregates only)
create or replace function public.owner_response(u uuid) returns json language sql stable security definer set search_path=public as $$
 with c as (select id from conversations where user_b=u),
 f as (select c.id, min(m.created_at) filter (where m.sender_id<>u) fm, min(m.created_at) filter (where m.sender_id=u) rp
       from c join messages m on m.conversation_id=c.id group by c.id having count(*) filter (where m.sender_id<>u)>0)
 select json_build_object('convs',count(*),'replied',count(rp),'median_min',(percentile_cont(.5) within group (order by extract(epoch from rp-fm)/60) filter (where rp>=fm))) from f $$;
grant execute on function public.owner_response(uuid) to anon, authenticated;

-- ---------- admin: server-side authorization + audit log ----------
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid, action text not null, target_type text, target_id text, result text, meta jsonb, created_at timestamptz not null default now());
alter table audit_logs enable row level security;
create policy al_sel on audit_logs for select to authenticated using (is_admin());
create or replace function public.admin_listing_action(lid uuid, act text, note text default '') returns void language plpgsql security definer set search_path=public as $$
declare o uuid; nm text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select owner_id,name into o,nm from listings where id=lid; if o is null then raise exception 'not found'; end if;
  if act='verify' then update listings set verification='verified', admin_note=null where id=lid;
  elsif act='reject' then update listings set verification='rejected', admin_note=note where id=lid;
  elsif act='request_changes' then update listings set admin_note=note, verification=case when verification='verified' then 'pending' else verification end where id=lid;
  elsif act='suspend' then update listings set state='suspended', admin_note=note where id=lid;
  elsif act='unsuspend' then update listings set state='active', admin_note=null where id=lid;
  elsif act='remove' then delete from listings where id=lid;
  else raise exception 'bad action'; end if;
  insert into audit_logs(actor_id,action,target_type,target_id,result,meta) values(auth.uid(),act,'listing',lid::text,'ok',jsonb_build_object('note',left(note,200)));
  perform notify(o,'moderation','लिस्टिंग अपडेट: '||act,coalesce(nm,'')||' '||left(note,120),lid::text);
end $$;
create or replace function public.admin_resolve_report(rid uuid, res text, note text default '') returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
  update reports set status=case when res='dismissed' then 'dismissed' else 'actioned' end, resolution=left(note,300) where id=rid;
  insert into audit_logs(actor_id,action,target_type,target_id,result) values(auth.uid(),'report_'||res,'report',rid::text,'ok'); end $$;
create or replace function public.admin_set_banned(uid uuid, b boolean) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if; if uid=auth.uid() then raise exception 'cannot ban self'; end if;
  update profiles set banned=b where id=uid;
  insert into audit_logs(actor_id,action,target_type,target_id,result) values(auth.uid(),case when b then 'ban' else 'unban' end,'user',uid::text,'ok'); end $$;
create or replace function public.admin_stats() returns json language plpgsql stable security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
 return json_build_object('users',(select count(*) from profiles),'owners',(select count(*) from profiles where role='owner'),'listings',(select count(*) from listings),'active',(select count(*) from listings where state='active'),
  'pending',(select count(*) from listings where verification='pending'),'verified',(select count(*) from listings where verification='verified'),'reported',(select count(distinct listing_id) from reports where status='open'),
  'visits',(select count(*) from visits),'bookings',(select count(*) from bookings),'messages',(select count(*) from messages)); end $$;
-- duplicate photos (perceptual-hash Hamming distance <= 5) — for admin REVIEW, nothing is auto-deleted
create or replace function public.duplicate_photo_pairs() returns table(listing_a uuid, listing_b uuid, distance int) language plpgsql stable security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
 return query select p.listing_id, q.listing_id, bit_count(('x'||p.phash)::bit(64) # ('x'||q.phash)::bit(64))::int
  from listing_photos p join listing_photos q on p.id<q.id and p.listing_id<>q.listing_id
  where p.phash is not null and q.phash is not null and bit_count(('x'||p.phash)::bit(64) # ('x'||q.phash)::bit(64))<=5;
end $$;
create or replace function public.suspicious_listings() returns table(listing_id uuid, name text, reasons text[]) language plpgsql stable security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
 return query
 with avg_area as (select lower(x.area) k, avg(x.rent) av, count(*) n from listings x where x.state='active' group by 1),
 fl as (select l.id lid, l.name lname, array_remove(array[
    case when l.phone<>'' and (select count(*) from listings x where x.phone=l.phone)>=3 then 'एक फोन पर 3+ लिस्टिंग' end,
    case when a.n>=4 and l.rent < a.av*0.55 then 'किराया इलाके से बहुत कम' end,
    case when a.n>=4 and l.rent > a.av*2 then 'किराया इलाके से बहुत ज़्यादा' end,
    case when l.description<>'' and (select count(*) from listings x where x.description=l.description)>=2 then 'एक जैसा विवरण' end,
    case when (select count(*) from reports r where r.listing_id=l.id and r.status='open')>=2 then 'कई रिपोर्ट' end,
    case when exists(select 1 from duplicate_photo_pairs() d where d.listing_a=l.id or d.listing_b=l.id) then 'डुप्लीकेट फोटो' end
   ],null) rs from listings l left join avg_area a on a.k=lower(l.area))
 select fl.lid, fl.lname, fl.rs from fl where array_length(fl.rs,1)>0;
end $$;

-- ---------- account deletion ----------
create or replace function public.delete_my_account() returns void language sql security definer set search_path=public,auth as $$ delete from auth.users where id=auth.uid() $$;
revoke all on function public.delete_my_account() from public, anon; grant execute on function public.delete_my_account() to authenticated;

-- ---------- realtime ----------
alter publication supabase_realtime add table public.messages, public.notifications;

-- After signing up your own account, make yourself admin (SQL Editor only; the app cannot do this):
-- update public.profiles set role='admin' where id = (select id from auth.users where email='YOU@example.com');
