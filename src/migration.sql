-- Migration: tactical roles, FC cards, bulk actions, matchweek awards.
-- Idempotent: safe to run more than once. Run in the Supabase SQL Editor BEFORE deploying the new App.jsx.

-- ===== Tactical roles + FC cards (admin-only, stored in player_ratings) =====
alter table player_ratings
  add column if not exists role text default 'מאוזן',
  add column if not exists height_cm int default 175,
  add column if not exists pac int default 70,
  add column if not exists sho int default 70,
  add column if not exists pas int default 70,
  add column if not exists dri int default 70,
  add column if not exists def int default 70,
  add column if not exists phy int default 70;
alter table player_ratings drop constraint if exists player_ratings_role_check;
alter table player_ratings add constraint player_ratings_role_check
  check (role in ('מאוזן', 'הגנה / שוער', 'קישור / פליימייקר', 'התקפה / סקורר', 'כושר / רץ'));
alter table player_ratings drop constraint if exists player_ratings_card_check;
alter table player_ratings add constraint player_ratings_card_check
  check (height_cm between 150 and 210 and pac between 40 and 99 and sho between 40 and 99
     and pas between 40 and 99 and dri between 40 and 99 and def between 40 and 99 and phy between 40 and 99);

create or replace function admin_set_role(p_pin text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  insert into player_ratings (player_name, role) values (trim(p_name), p_role)
  on conflict (player_name) do update set role = excluded.role; end $$;

-- Saves the full card and derives rating (1-5, half steps) from the 6-stat average.
-- A manual rating chosen later in the dropdown (admin_set_rating) still overrides it.
create or replace function admin_set_player_card(
  p_pin text, p_name text, p_role text, p_height_cm int,
  p_pac int, p_sho int, p_pas int, p_dri int, p_def int, p_phy int
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_rating numeric;
begin perform _assert_pin(p_pin);
  v_rating := least(5, greatest(1,
    round((1 + 4 * (((p_pac + p_sho + p_pas + p_dri + p_def + p_phy) / 6.0) - 40) / 59.0) * 2) / 2));
  insert into player_ratings (player_name, rating, role, height_cm, pac, sho, pas, dri, def, phy)
  values (trim(p_name), v_rating, p_role, p_height_cm, p_pac, p_sho, p_pas, p_dri, p_def, p_phy)
  on conflict (player_name) do update set rating = excluded.rating, role = excluded.role,
    height_cm = excluded.height_cm, pac = excluded.pac, sho = excluded.sho, pas = excluded.pas,
    dri = excluded.dri, def = excluded.def, phy = excluded.phy;
  return v_rating; end $$;

-- ===== Bulk actions =====
-- Approves all pending in sign-up order: free spots (up to 15) become confirmed, the rest go to the waitlist.
create or replace function admin_approve_all(p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c int; np int; free int;
begin perform _assert_pin(p_pin);
  select count(*) into c from registrations where status = 'confirmed';
  select count(*) into np from registrations where status = 'pending';
  free := greatest(15 - c, 0);
  with ordered as (select id, row_number() over (order by created_at) as rn from registrations where status = 'pending')
  update registrations r set
    status = case when o.rn <= free then 'confirmed' else 'waitlist' end,
    approved_at = case when o.rn <= free then now() else null end
  from ordered o where r.id = o.id;
  return jsonb_build_object('confirmed', least(free, np), 'waitlist', greatest(np - free, 0)); end $$;

create or replace function admin_set_all_paid(p_pin text, p_is_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  update registrations set is_paid = p_is_paid where status = 'confirmed'; end $$;

-- ===== Matchweek awards (נתוני מחזור) =====
-- Own table so unpublished awards can't be read by the public (RLS only exposes the row once published).
create table if not exists matchweek_awards (
  id int primary key default 1 check (id = 1),
  top_scorer text default '',
  mvp_star text default '',
  best_duo text default '',
  awards_published boolean default false
);
insert into matchweek_awards (id) values (1) on conflict do nothing;
alter table matchweek_awards enable row level security;
drop policy if exists "public reads published awards" on matchweek_awards;
create policy "public reads published awards" on matchweek_awards for select using (awards_published = true);
do $$ begin
  alter publication supabase_realtime add table matchweek_awards;
exception when duplicate_object then null; end $$;

create or replace function admin_get_awards(p_pin text) returns setof matchweek_awards
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin); return query select * from matchweek_awards where id = 1; end $$;

create or replace function admin_save_awards(
  p_pin text, p_top_scorer text, p_mvp_star text, p_best_duo text, p_published boolean
) returns void language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  update matchweek_awards set top_scorer = left(trim(coalesce(p_top_scorer, '')), 60),
    mvp_star = left(trim(coalesce(p_mvp_star, '')), 60), best_duo = left(trim(coalesce(p_best_duo, '')), 60),
    awards_published = p_published where id = 1; end $$;

-- Weekly reset: clears registrations, drafts and awards, unpublishes teams. Keeps player_ratings (ratings, roles, FC cards).
create or replace function admin_reset_match(p_pin text, p_match_time text, p_price int, p_bit_link text) returns void
language plpgsql security definer set search_path = public as $$
begin perform _assert_pin(p_pin);
  delete from team_drafts where true;
  delete from registrations where true;
  update matchweek_awards set top_scorer = '', mvp_star = '', best_duo = '', awards_published = false where id = 1;
  update match_settings set teams_published = false, match_time = p_match_time,
    price = p_price, bit_link = p_bit_link where id = 1; end $$;
