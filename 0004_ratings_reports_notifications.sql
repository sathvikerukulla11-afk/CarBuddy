-- ============================================================================
-- 0004  Ratings, reports, notifications
-- ============================================================================

create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null references public.rides(id) on delete cascade,
  rater_id   uuid not null references public.profiles(id) on delete cascade,
  ratee_id   uuid not null references public.profiles(id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  comment    text check (comment is null or char_length(comment) <= 400),
  created_at timestamptz not null default now(),
  -- One rating per person, per person, per ride.
  unique (ride_id, rater_id, ratee_id),
  constraint no_self_rating check (rater_id <> ratee_id)
);

create index if not exists ratings_ratee_idx on public.ratings(ratee_id);

create or replace function public.guard_rating_writes()
returns trigger language plpgsql
as $$
begin
  if not public.is_privileged() then
    raise exception 'Ratings must be submitted through the rate_user action' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_ratings on public.ratings;
create trigger trg_guard_ratings before insert or update or delete on public.ratings
  for each row execute function public.guard_rating_writes();

-- Recompute the rated member's average whenever a rating lands.
create or replace function public.sync_profile_rating()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid := coalesce(new.ratee_id, old.ratee_id);
begin
  perform public.begin_privileged();
  update public.profiles p
     set rating_avg   = coalesce((select round(avg(stars)::numeric, 2)
                                    from public.ratings where ratee_id = v_user), 0),
         rating_count = (select count(*) from public.ratings where ratee_id = v_user)
   where p.id = v_user;
  return null;
end $$;

drop trigger if exists trg_sync_rating on public.ratings;
create trigger trg_sync_rating after insert or update or delete on public.ratings
  for each row execute function public.sync_profile_rating();

-- --------------------------------------------------------------- reports ---
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.profiles(id) on delete cascade,
  reported_user_id  uuid references public.profiles(id) on delete cascade,
  ride_id           uuid references public.rides(id) on delete set null,
  category          text not null check (category in (
                      'unsafe_driving', 'harassment', 'no_show', 'inappropriate_content',
                      'scam_or_payment', 'fake_profile', 'underage_safety', 'other')),
  details           text not null check (char_length(trim(details)) between 5 and 2000),
  status            public.report_status not null default 'open',
  admin_notes       text,
  resolved_by       uuid references public.profiles(id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint report_has_target check (reported_user_id is not null or ride_id is not null),
  constraint no_self_report check (reported_user_id is null or reported_user_id <> reporter_id)
);

create index if not exists reports_status_idx on public.reports(status, created_at desc);

create or replace function public.guard_report_updates()
returns trigger language plpgsql
as $$
begin
  if not public.is_privileged() and not public.is_admin() then
    raise exception 'Only administrators can update a report' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_reports on public.reports;
create trigger trg_guard_reports before update or delete on public.reports
  for each row execute function public.guard_report_updates();

-- --------------------------------------------------------- notifications ---
-- Written only by server-side functions. A future Expo app reads the same rows
-- and can subscribe with supabase.channel(...) for push-style delivery.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  ride_id    uuid references public.rides(id) on delete cascade,
  request_id uuid references public.ride_requests(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

create or replace function public.notify_user(
  p_user uuid, p_type text, p_title text, p_body text default null,
  p_ride uuid default null, p_request uuid default null, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, title, body, ride_id, request_id, data)
  values (p_user, p_type, p_title, p_body, p_ride, p_request, coalesce(p_data, '{}'::jsonb));
end $$;

revoke all on function public.notify_user(uuid, text, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Members may only ever flip their own notification to read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Live delivery for the notification bell (and, later, mobile push).
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;   -- publication absent in a bare Postgres
end $$;
