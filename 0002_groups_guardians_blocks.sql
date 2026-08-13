-- ============================================================================
-- 0002  Trusted groups, guardian relationships, blocking
--       (defined before rides because ride visibility policies depend on them)
-- ============================================================================

create table if not exists public.trusted_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 80),
  description text,
  area        text,
  group_type  public.group_type not null default 'other',
  join_code   text not null unique default public.random_code(7),
  is_open     boolean not null default false,   -- true = auto-approve joins by code
  created_by  uuid not null references public.profiles(id) on delete cascade,
  member_count integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.trusted_groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('member', 'admin')),
  status    public.member_status not null default 'pending',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members(user_id, status);

create or replace function public.is_group_member(p_group uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select p_group is not null and p_uid is not null and exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_uid and status = 'active');
$$;

create or replace function public.is_group_admin(p_group uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_uid and status = 'active' and role = 'admin'
  ) or exists (
    select 1 from public.trusted_groups where id = p_group and created_by = p_uid);
$$;

create or replace function public.sync_group_member_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_group uuid := coalesce(new.group_id, old.group_id);
begin
  update public.trusted_groups
     set member_count = (select count(*) from public.group_members
                          where group_id = v_group and status = 'active'),
         updated_at = now()
   where id = v_group;
  return null;
end $$;

drop trigger if exists trg_group_member_count on public.group_members;
create trigger trg_group_member_count
  after insert or update or delete on public.group_members
  for each row execute function public.sync_group_member_count();

-- The creator of a group is automatically its first active admin member.
create or replace function public.add_group_creator_as_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.group_members (group_id, user_id, role, status)
  values (new.id, new.created_by, 'admin', 'active')
  on conflict (group_id, user_id) do update set role = 'admin', status = 'active';
  return new;
end $$;

drop trigger if exists trg_group_creator on public.trusted_groups;
create trigger trg_group_creator after insert on public.trusted_groups
  for each row execute function public.add_group_creator_as_admin();

-- ------------------------------------------------------------- blocking ----
create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create index if not exists blocked_users_blocked_idx on public.blocked_users(blocked_id);

-- True when either party has blocked the other. Used to hide rides both ways.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocked_users
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a));
$$;

-- -------------------------------------------- guardian <-> minor linkage ---
create table if not exists public.guardian_relationships (
  id           uuid primary key default gen_random_uuid(),
  guardian_id  uuid references public.profiles(id) on delete cascade,
  minor_id     uuid not null references public.profiles(id) on delete cascade,
  status       public.guardian_link_status not null default 'pending',
  invite_code  text unique,
  relationship text,
  created_at   timestamptz not null default now(),
  linked_at    timestamptz,
  revoked_at   timestamptz
);

create unique index if not exists guardian_rel_unique_active
  on public.guardian_relationships(guardian_id, minor_id) where status = 'active';
create index if not exists guardian_rel_minor_idx    on public.guardian_relationships(minor_id, status);
create index if not exists guardian_rel_guardian_idx on public.guardian_relationships(guardian_id, status);

create or replace function public.is_guardian_of(p_minor uuid, p_guardian uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select p_minor is not null and p_guardian is not null and exists (
    select 1 from public.guardian_relationships
    where minor_id = p_minor and guardian_id = p_guardian and status = 'active');
$$;

create or replace function public.has_active_guardian(p_minor uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.guardian_relationships
    where minor_id = p_minor and status = 'active');
$$;

-- A member may act (post/join rides) when not suspended and, if a minor, when a
-- guardian is linked to their account.
create or replace function public.can_participate(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_uid and p.is_suspended = false
      and (p.is_minor = false or public.has_active_guardian(p.id)));
$$;

grant execute on function public.is_group_member(uuid, uuid)   to authenticated;
grant execute on function public.is_group_admin(uuid, uuid)    to authenticated;
grant execute on function public.is_blocked_between(uuid,uuid) to authenticated;
grant execute on function public.is_guardian_of(uuid, uuid)    to authenticated;
grant execute on function public.has_active_guardian(uuid)     to authenticated;
grant execute on function public.can_participate(uuid)         to authenticated;
