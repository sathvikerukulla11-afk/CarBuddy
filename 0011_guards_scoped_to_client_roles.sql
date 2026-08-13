-- ============================================================================
-- 0011  ON DELETE SET NULL fired the UPDATE arm of the guards, so account
--       deletion still failed (ride_requests.guardian_id,
--       ride_participants.request_id, reports.resolved_by).
-- ============================================================================
-- Root cause: the guards asked "is this transaction privileged?" when the
-- question that matters is "is a client doing this?". PostgREST connects as
-- `authenticated` or `anon`; SECURITY DEFINER functions run as the owner, and
-- foreign-key cascades run as whoever issued the parent statement. Protection
-- is unchanged for every path a browser or mobile app can take.

create or replace function public.is_client_role()
returns boolean language sql stable set search_path = public, pg_temp
as $$ select current_user in ('authenticated', 'anon') $$;

create or replace function public.guard_request_writes()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() then
    raise exception 'Join requests must be changed through the request/respond actions'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

create or replace function public.guard_participant_writes()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() then
    raise exception 'Ride membership is managed by the server' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.guard_rating_writes()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() then
    raise exception 'Ratings must be submitted through the rate_user action'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.guard_report_updates()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() and not public.is_admin() then
    raise exception 'Only administrators can update a report' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.guard_profile_columns()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() then
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
    if new.age_category is distinct from old.age_category
       and old.age_category <> 'adult' and new.age_category = 'adult' then
      raise exception 'Age category can only be raised to adult by an administrator'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.guard_ride_columns()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_role() and not public.is_privileged() then
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

grant execute on function public.is_client_role() to authenticated;
