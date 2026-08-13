-- ============================================================================
-- 0003  Rides, meetup details, join requests, participants, seat integrity
-- ============================================================================

create table if not exists public.rides (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.profiles(id) on delete cascade,

  origin_label        text not null check (char_length(trim(origin_label)) between 2 and 120),
  origin_area         text,
  destination_label   text not null check (char_length(trim(destination_label)) between 2 and 120),
  destination_area    text,

  depart_date         date not null,
  depart_time         time not null,
  depart_at           timestamptz not null,

  seats_offered       smallint not null check (seats_offered between 1 and 8),
  seats_taken         smallint not null default 0 check (seats_taken >= 0),
  -- Derived in the database so no client can ever disagree with the server.
  seats_remaining     smallint generated always as ((seats_offered - seats_taken)::smallint) stored,

  contribution_amount numeric(6,2) not null default 0
                        check (contribution_amount >= 0 and contribution_amount <= 200),
  notes               text check (notes is null or char_length(notes) <= 1000),

  visibility          public.ride_visibility not null default 'verified',
  group_id            uuid references public.trusted_groups(id) on delete set null,
  -- Unlisted rides are reachable by direct link only.
  is_listed           boolean generated always as (visibility <> 'approval') stored,

  status              public.ride_status not null default 'upcoming',
  cancelled_reason    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint seats_not_overbooked check (seats_taken <= seats_offered),
  constraint group_ride_needs_group check (visibility <> 'group' or group_id is not null)
);

create index if not exists rides_search_idx  on public.rides(status, depart_at);
create index if not exists rides_driver_idx  on public.rides(driver_id, depart_at desc);
-- Search uses ILIKE, which is fine at community scale. If this ever needs to
-- go faster, install pg_trgm in the `extensions` schema and add
-- GIN (origin_label extensions.gin_trgm_ops) indexes here.
create index if not exists rides_date_idx    on public.rides(depart_date, status);
create index if not exists rides_group_idx   on public.rides(group_id) where group_id is not null;

-- Pickup/meetup specifics are NOT public. Separate table, separate policy.
create table if not exists public.ride_meetups (
  ride_id       uuid primary key references public.rides(id) on delete cascade,
  meetup_place  text,
  meetup_notes  text,
  driver_phone_share boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------- ride guards ----
create or replace function public.guard_ride_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_privileged() then
    if new.seats_taken is distinct from old.seats_taken then
      raise exception 'Seat counts are managed by the server and cannot be edited'
        using errcode = '42501';
    end if;
    if new.driver_id is distinct from old.driver_id then
      raise exception 'A ride cannot be transferred to another driver'
        using errcode = '42501';
    end if;
    if new.seats_offered < old.seats_taken then
      raise exception 'You cannot offer fewer seats than are already filled (%).', old.seats_taken
        using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_ride on public.rides;
create trigger trg_guard_ride
  before update on public.rides
  for each row execute function public.guard_ride_columns();

-- New rides always start empty and must belong to the caller.
create or replace function public.guard_ride_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.seats_taken := 0;
  new.status      := coalesce(new.status, 'upcoming');

  if new.driver_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'You can only post rides for yourself' using errcode = '42501';
  end if;

  if not public.can_participate(new.driver_id) then
    raise exception 'Your account cannot post rides yet. Minors need a linked guardian, and suspended accounts are blocked.'
      using errcode = '42501';
  end if;

  if new.visibility = 'group' and not public.is_group_member(new.group_id, new.driver_id) then
    raise exception 'You must be an active member of that trusted group' using errcode = '42501';
  end if;

  if new.depart_at < now() - interval '1 hour' then
    raise exception 'Departure time is in the past' using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_ride_insert on public.rides;
create trigger trg_guard_ride_insert
  before insert on public.rides
  for each row execute function public.guard_ride_insert();

drop trigger if exists trg_touch_ride_meetups on public.ride_meetups;
create trigger trg_touch_ride_meetups
  before update on public.ride_meetups
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- join requests -----
create table if not exists public.ride_requests (
  id               uuid primary key default gen_random_uuid(),
  ride_id          uuid not null references public.rides(id) on delete cascade,
  rider_id         uuid not null references public.profiles(id) on delete cascade,
  seats_requested  smallint not null default 1 check (seats_requested between 1 and 4),
  message          text check (message is null or char_length(message) <= 500),
  status           public.request_status not null default 'pending',

  guardian_status  public.guardian_approval not null default 'not_required',
  guardian_id      uuid references public.profiles(id) on delete set null,
  guardian_note    text,
  guardian_decided_at timestamptz,

  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One live request per rider per ride.
create unique index if not exists ride_requests_one_active
  on public.ride_requests(ride_id, rider_id)
  where status in ('pending', 'accepted');

create index if not exists ride_requests_ride_idx  on public.ride_requests(ride_id, status);
create index if not exists ride_requests_rider_idx on public.ride_requests(rider_id, status);
create index if not exists ride_requests_guardian_idx on public.ride_requests(guardian_status)
  where guardian_status = 'pending';

-- Requests are only ever written through the RPCs in 0006. Direct writes fail.
create or replace function public.guard_request_writes()
returns trigger
language plpgsql
as $$
begin
  if not public.is_privileged() then
    raise exception 'Join requests must be changed through the request/respond actions'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_requests on public.ride_requests;
create trigger trg_guard_requests
  before insert or update or delete on public.ride_requests
  for each row execute function public.guard_request_writes();

-- -------------------------------------------------------- participants -----
create table if not exists public.ride_participants (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null references public.rides(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.ride_requests(id) on delete set null,
  seats      smallint not null default 1 check (seats between 1 and 4),
  status     public.participant_status not null default 'joined',
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique (ride_id, user_id)
);

create index if not exists ride_participants_user_idx on public.ride_participants(user_id, status);

create or replace function public.guard_participant_writes()
returns trigger
language plpgsql
as $$
begin
  if not public.is_privileged() then
    raise exception 'Ride membership is managed by the server' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_participants on public.ride_participants;
create trigger trg_guard_participants
  before insert or update or delete on public.ride_participants
  for each row execute function public.guard_participant_writes();

-- ------------------------------------------------------- ride helpers ------
create or replace function public.is_ride_driver(p_ride uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.rides where id = p_ride and driver_id = p_uid);
$$;

create or replace function public.is_ride_participant(p_ride uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ride_participants
    where ride_id = p_ride and user_id = p_uid and status = 'joined'
  );
$$;

create or replace function public.has_request_on_ride(p_ride uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ride_requests where ride_id = p_ride and rider_id = p_uid
  );
$$;

-- A guardian can see everything about rides their linked minor is involved in.
create or replace function public.guards_someone_on_ride(p_ride uuid, p_guardian uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.ride_requests rq
    join public.guardian_relationships gr
      on gr.minor_id = rq.rider_id and gr.status = 'active'
    where rq.ride_id = p_ride and gr.guardian_id = p_guardian
  );
$$;

grant execute on function public.is_ride_driver(uuid, uuid)          to authenticated;
grant execute on function public.is_ride_participant(uuid, uuid)     to authenticated;
grant execute on function public.has_request_on_ride(uuid, uuid)     to authenticated;
grant execute on function public.guards_someone_on_ride(uuid, uuid)  to authenticated;

-- ------------------------------------ seat recount safety net (assertion) ---
-- seats_taken is only ever changed by respond_to_request / cancel / leave, all
-- of which lock the ride row. This function lets an admin verify integrity.
create or replace function public.recount_ride_seats(p_ride uuid)
returns smallint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count smallint;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  perform public.begin_privileged();
  select coalesce(sum(seats), 0) into v_count
    from public.ride_participants where ride_id = p_ride and status = 'joined';
  update public.rides set seats_taken = v_count where id = p_ride;
  return v_count;
end $$;

grant execute on function public.recount_ride_seats(uuid) to authenticated;
