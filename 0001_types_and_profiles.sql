-- ============================================================================
-- 0001  Enums, helper functions, profiles + private profile data
-- ============================================================================

-- ------------------------------------------------------------------ enums --
do $$ begin
  create type public.age_category         as enum ('under_16', 'age_16_17', 'adult');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.verification_status  as enum ('unverified', 'pending', 'verified', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ride_status          as enum ('upcoming', 'active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.request_status       as enum ('pending', 'accepted', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.guardian_approval    as enum ('not_required', 'pending', 'approved', 'denied');
exception when duplicate_object then null; end $$;
do $$ begin
  -- 'verified' = any verified user may request
  -- 'group'    = only members of the selected trusted group may request
  -- 'approval' = unlisted; reachable only by direct link, driver approves individually
  create type public.ride_visibility      as enum ('verified', 'group', 'approval');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.participant_status   as enum ('joined', 'left', 'removed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.group_type           as enum ('school', 'neighborhood', 'sports', 'club', 'organization', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.member_status        as enum ('pending', 'active', 'removed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_status        as enum ('open', 'reviewing', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.guardian_link_status as enum ('pending', 'active', 'revoked');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------- utilities --
-- Marks the current transaction as running privileged (system) logic. Only
-- SECURITY DEFINER functions in this schema can call it, so client code can
-- never flip the flag and bypass the column guards below.
create or replace function public.begin_privileged()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform set_config('app.privileged', 'on', true); end $$;
revoke all on function public.begin_privileged() from public, anon, authenticated;

create or replace function public.is_privileged()
returns boolean language sql stable
as $$ select coalesce(current_setting('app.privileged', true), '') = 'on' $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

-- Deliberately avoids pgcrypto (which lives in the `extensions` schema on
-- Supabase and would not resolve inside search_path-pinned functions).
-- The alphabet omits 0/O and 1/I so codes can be read aloud over the phone.
create or replace function public.random_code(len int default 8)
returns text language sql volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  (floor(random() * 31) + 1)::int, 1), '')
    from generate_series(1, greatest(coalesce(len, 8), 4));
$$;

-- ------------------------------------------------------------- profiles ----
-- PUBLIC-SAFE fields only. Anything sensitive lives in profiles_private.
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default 'New member',
  avatar_url          text,
  bio                 text,
  home_area           text,                       -- "Frisco, TX" - never a street address
  age_category        public.age_category not null default 'adult',
  is_minor            boolean generated always as (age_category <> 'adult') stored,
  verification_status public.verification_status not null default 'unverified',
  is_admin            boolean not null default false,
  is_suspended        boolean not null default false,
  suspended_reason    text,
  rating_avg          numeric(3,2) not null default 0,
  rating_count        integer not null default 0,
  rides_completed     integer not null default 0,
  onboarded           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.profiles is
  'Public-facing profile. Contains no contact details - see profiles_private.';

-- Sensitive contact data, never readable by other members directly.
create table if not exists public.profiles_private (
  id                  uuid primary key references public.profiles(id) on delete cascade,
  email               text,
  phone               text,
  date_of_birth       date,
  emergency_contact_name  text,
  emergency_contact_phone text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists profiles_verification_idx on public.profiles(verification_status);
create index if not exists profiles_admin_idx        on public.profiles(is_admin) where is_admin;

-- Guard privileged columns: a member may edit their own name/bio/photo, but
-- never their rating, verification, admin flag, or suspension state.
create or replace function public.guard_profile_columns()
returns trigger language plpgsql
as $$
begin
  if not public.is_privileged() then
    if new.rating_avg          is distinct from old.rating_avg
    or new.rating_count        is distinct from old.rating_count
    or new.rides_completed     is distinct from old.rides_completed
    or new.verification_status is distinct from old.verification_status
    or new.is_admin            is distinct from old.is_admin
    or new.is_suspended        is distinct from old.is_suspended
    or new.suspended_reason    is distinct from old.suspended_reason
    then
      raise exception 'Protected profile fields cannot be modified directly'
        using errcode = '42501';
    end if;
    -- A minor cannot promote themselves to 'adult' to escape guardian approval.
    if new.age_category is distinct from old.age_category
       and old.age_category <> 'adult' and new.age_category = 'adult' then
      raise exception 'Age category can only be raised to adult by an administrator'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_columns();

drop trigger if exists trg_touch_profiles_private on public.profiles_private;
create trigger trg_touch_profiles_private before update on public.profiles_private
  for each row execute function public.touch_updated_at();

-- ------------------------------------------- create profile on auth signup --
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_age public.age_category;
begin
  begin
    v_age := coalesce((new.raw_user_meta_data ->> 'age_category')::public.age_category, 'adult');
  exception when others then
    v_age := 'adult';
  end;

  insert into public.profiles (id, full_name, age_category)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          v_age)
  on conflict (id) do nothing;

  insert into public.profiles_private (id, email, phone)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data ->> 'phone'), ''))
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------ security helpers ---
-- SECURITY DEFINER so policies can call them without recursive RLS evaluation.
create or replace function public.is_admin(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select is_admin from public.profiles where id = p_uid), false); $$;

create or replace function public.is_suspended(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select is_suspended from public.profiles where id = p_uid), false); $$;

create or replace function public.is_verified(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select verification_status = 'verified' from public.profiles where id = p_uid), false); $$;

grant execute on function public.is_admin(uuid)     to authenticated;
grant execute on function public.is_suspended(uuid) to authenticated;
grant execute on function public.is_verified(uuid)  to authenticated;
