-- 5v5 Match Manager: run once in the Supabase SQL Editor.
create extension if not exists pgcrypto with schema extensions;

create table if not exists match_settings (
  id int primary key default 1 check (id = 1),
  location text default 'וייסגל רחובות',
  match_time text default 'יום שני, 21:30',
  price int default 20,
  bit_link text default 'https://www.bitpay.co.il/app/share-info?i=2prr9sGd&j=true',
  team_colors jsonb default '["שחור", "לבן", "אדום"]',
  teams_published boolean default false,
  title text default 'כדורגל וייסגל'
);
alter table match_settings add column if not exists title text default 'כדורגל וייסגל'; -- for projects created earlier
insert into match_settings (id) values (1) on conflict do nothing;

create table if not exists player_ratings (
  id uuid primary key default gen_random_uuid(),
  player_name text unique not null,
  rating numeric(3,1) default 3 check (rating >= 1 and rating <= 5 and rating * 2 = floor(rating * 2))
);

-- Migration for projects created with integer ratings (safe to re-run)
alter table player_ratings alter column rating type numeric(3,1);
alter table player_ratings alter column rating set default 3;
alter table player_ratings drop constraint if exists player_ratings_rating_check;
alter table player_ratings add constraint player_ratings_rating_check
  check (rating >= 1 and rating <= 5 and rating * 2 = floor(rating * 2));

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (char_length(trim(player_name)) between 2 and 40),
  status text default 'pending' check (status in ('pending','confirmed','waitlist','expired')),
  is_paid boolean default false,
  team_index int check (team_index in (0,1,2)),
  approved_at timestamptz,
  created_at timestamptz default now()
);

-- Draft team assignments (admin only). Copied to registrations.team_index only while teams are published,
-- so the public never sees team_index before publishing.
create table if not exists team_drafts (
  registration_id uuid primary key references registrations(id) on delete cascade,
  team_index int not null check (team_index in (0,1,2))
);

-- Admin PIN lives in a table nobody can read directly (stored hashed).
create table if not exists admin_config (id int primary key default 1, pin_hash text not null);
insert into admin_config (id, pin_hash) values (1, extensions.crypt('1709', extensions.gen_salt('bf')))
  on conflict do nothing;

-- RLS
alter table match_settings enable row level security;
alter table player_ratings enable row level security;   -- no policies: no public access
alter table registrations enable row level security;
alter table team_drafts enable row level security;     -- no policies: no public access
alter table admin_config enable row level security;     -- no policies: no public access

drop policy if exists "public reads settings" on match_settings;
create policy "public reads settings" on match_settings for select using (true);
drop policy if exists "public reads confirmed" on registrations;
create policy "public reads confirmed" on registrations for select using (status = 'confirmed');
drop policy if exists "public registers as pending" on registrations;
create policy "public registers as pending" on registrations for insert
  with check (status = 'pending' and is_paid = false and team_index is null and approved_at is null);

-- PIN check helper
create or replace function _assert_pin(p text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from admin_config where pin_hash = crypt(p, pin_hash)) then
    raise exception 'invalid pin';
  end if;
end $$;
revoke all on function _assert_pin(text) from public, anon, authenticated;

create or replace function check_pin(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from admin_config where pin_hash = crypt(p_pin, pin_hash));
$$;

-- Admin RPCs (every one verifies the PIN)
drop function if exists admin_list_registrations(text);
create function admin_list_registrations(p_pin text)
returns table (id uuid, player_name text, status text, is_paid boolean, approved_at timestamptz,
               created_at timestamptz, draft_team int)
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  return query select r.id, r.player_name, r.status, r.is_paid, r.approved_at, r.created_at, d.team_index
    from registrations r left join team_drafts d on d.registration_id = r.id
    where r.status <> 'expired' order by r.created_at; end $$;

create or replace function admin_approve(p_pin text, p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c int;
begin perform _assert_pin(p_pin);
  select count(*) into c from registrations where status = 'confirmed';
  if c < 15 then
    update registrations set status='confirmed', approved_at=now() where id=p_id and status='pending';
    return 'confirmed';
  end if;
  update registrations set status='waitlist' where id=p_id and status='pending';
  return 'waitlist'; end $$;

create or replace function admin_promote(p_pin text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c int;
begin perform _assert_pin(p_pin);
  select count(*) into c from registrations where status = 'confirmed';
  if c >= 15 then raise exception 'confirmed list is full'; end if;
  update registrations set status='confirmed', approved_at=now() where id=p_id and status='waitlist'; end $$;

create or replace function admin_set_paid(p_pin text, p_id uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  update registrations set is_paid = p_paid where id = p_id; end $$;

create or replace function admin_remove(p_pin text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin); delete from registrations where id = p_id; end $$;

create or replace function admin_update_settings(
  p_pin text, p_location text, p_match_time text, p_price int, p_bit_link text, p_team_colors jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  update match_settings set location=p_location, match_time=p_match_time, price=p_price,
    bit_link=p_bit_link, team_colors=p_team_colors where id = 1; end $$;

-- Ratings: admin only
create or replace function admin_get_ratings(p_pin text) returns setof player_ratings
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin); return query select * from player_ratings order by player_name; end $$;

drop function if exists admin_set_rating(text, text, int);
create or replace function admin_set_rating(p_pin text, p_name text, p_rating numeric) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  insert into player_ratings (player_name, rating) values (trim(p_name), p_rating)
  on conflict (player_name) do update set rating = excluded.rating; end $$;

-- Teams
create or replace function _sync_published() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select teams_published from match_settings where id = 1) then
    update registrations r set team_index = (select d.team_index from team_drafts d where d.registration_id = r.id)
    where r.status = 'confirmed';
  end if;
end $$;
revoke all on function _sync_published() from public, anon, authenticated;

create or replace function admin_set_team(p_pin text, p_id uuid, p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  if p_team is null then delete from team_drafts where registration_id = p_id;
  else insert into team_drafts (registration_id, team_index) values (p_id, p_team)
       on conflict (registration_id) do update set team_index = excluded.team_index; end if;
  perform _sync_published(); end $$;

-- p_assignments: [{"id": "<registration uuid>", "team_index": 0|1|2}, ...]
create or replace function admin_apply_teams(p_pin text, p_assignments jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  delete from team_drafts where true;
  insert into team_drafts (registration_id, team_index)
    select x.id, x.team_index from jsonb_to_recordset(p_assignments) as x(id uuid, team_index int);
  perform _sync_published(); end $$;

create or replace function admin_publish_teams(p_pin text, p_published boolean) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  update match_settings set teams_published = p_published where id = 1;
  if p_published then perform _sync_published();
  else update registrations set team_index = null where team_index is not null; end if; end $$;

-- Weekly reset: clears registrations (and drafts), unpublishes teams, keeps player_ratings.
create or replace function admin_reset_match(p_pin text, p_match_time text, p_price int, p_bit_link text) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  delete from team_drafts where true;
  delete from registrations where true;
  update match_settings set teams_published = false, match_time = p_match_time,
    price = p_price, bit_link = p_bit_link where id = 1; end $$;

-- 48h expiration: confirmed + unpaid + approved over 48h ago
create or replace function expire_unpaid() returns void
language sql security definer set search_path = public as $$
  update registrations set status = 'expired'
  where status = 'confirmed' and is_paid = false and approved_at < now() - interval '48 hours';
$$;
grant execute on function expire_unpaid() to anon, authenticated;

-- pg_cron (enable under Database > Extensions if this block errors)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('expire-unpaid', '*/10 * * * *', 'select expire_unpaid()');
exception when others then raise notice 'pg_cron not enabled; the app still runs expire_unpaid() on page load'; end $$;

-- Realtime
do $$ begin
  alter publication supabase_realtime add table match_settings, registrations;
exception when duplicate_object then null; end $$;
