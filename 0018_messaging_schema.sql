-- ============================================================================
-- 0018  Ride-scoped messaging
-- ============================================================================
-- One group conversation per ride. You cannot start a conversation with a
-- stranger: membership is granted by the server the moment a driver accepts a
-- rider, and by nothing else.

do $$ begin
  create type public.conversation_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null unique references public.rides(id) on delete cascade,
  status     public.conversation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'rider' check (role in ('driver', 'rider')),
  joined_at       timestamptz not null default now(),
  -- Drives the unread badge. Works for group conversations, where a single
  -- read_at on the message itself cannot express "who has read this".
  last_read_at    timestamptz,
  left_at         timestamptz,
  unique (conversation_id, user_id)
);

create index if not exists conv_members_user_idx on public.conversation_members(user_id)
  where left_at is null;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (char_length(trim(body)) between 1 and 2000),
  -- Per-message read receipt for one-to-one threads. The unread badge itself is
  -- computed from conversation_members.last_read_at.
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conv_idx on public.messages(conversation_id, created_at desc);

-- ------------------------------------------------------------- helpers ----
create or replace function public.is_conversation_member(p_conv uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select p_conv is not null and p_uid is not null and exists (
    select 1 from public.conversation_members
     where conversation_id = p_conv and user_id = p_uid and left_at is null);
$$;

grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

-- Creates the ride's conversation on first use and returns it. Never creates a
-- second one: ride_id is unique, and this is the only thing that inserts.
create or replace function public.ensure_ride_conversation(p_ride uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_driver uuid;
begin
  select id into v_conv from public.conversations where ride_id = p_ride;
  if v_conv is not null then return v_conv; end if;

  select driver_id into v_driver from public.rides where id = p_ride;
  if v_driver is null then raise exception 'No such ride' using errcode = 'P0002'; end if;

  insert into public.conversations (ride_id) values (p_ride)
  on conflict (ride_id) do update set updated_at = now()
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, v_driver, 'driver')
  on conflict (conversation_id, user_id) do nothing;

  return v_conv;
end $$;

revoke all on function public.ensure_ride_conversation(uuid) from public, anon, authenticated;

create or replace function public.add_conversation_member(p_ride uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid;
begin
  v_conv := public.ensure_ride_conversation(p_ride);
  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, p_user, 'rider')
  on conflict (conversation_id, user_id) do update set left_at = null;
  update public.conversations set updated_at = now() where id = v_conv;
  return v_conv;
end $$;

revoke all on function public.add_conversation_member(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------- RLS ----
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated using (public.is_conversation_member(id));

drop policy if exists conv_members_select on public.conversation_members;
create policy conv_members_select on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));

-- No insert/update/delete policies anywhere. Membership is granted only by the
-- server when a driver accepts, and messages are written only by send_message(),
-- which makes them immutable to clients and impossible to forge a sender for.

grant select on public.conversations        to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.messages             to authenticated;

-- ------------------------------------------------------------- realtime ----
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null;
end $$;
