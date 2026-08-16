-- ============================================================================
-- 0014  Admin audit log + an explicit role, and logging on every admin action
-- ============================================================================

create table if not exists public.admin_actions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_type  text,                       -- 'user' | 'ride' | 'report'
  target_id    uuid,
  target_label text,                       -- human-readable, survives deletion
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_actions_time_idx   on public.admin_actions(created_at desc);
create index if not exists admin_actions_admin_idx  on public.admin_actions(admin_id, created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions(target_type, target_id);

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions
  for select to authenticated using (public.is_admin());

-- No insert/update/delete policy at all: the log is append-only, and only the
-- SECURITY DEFINER helper below can append to it.
grant select on public.admin_actions to authenticated;

create or replace function public.log_admin_action(
  p_action text, p_target_type text default null, p_target_id uuid default null,
  p_target_label text default null, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.admin_actions (admin_id, action, target_type, target_id, target_label, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_target_label, coalesce(p_details, '{}'::jsonb));
end $$;

revoke all on function public.log_admin_action(text, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- role -----
-- A 'user' | 'admin' role, derived from is_admin so there is a single source of
-- truth. Because it is GENERATED nobody can write to it directly — not an admin,
-- and certainly not the account itself.
alter table public.profiles
  add column if not exists role text
  generated always as (case when is_admin then 'admin' else 'user' end) stored;

-- ------------------------------------------- logging on existing actions ---
create or replace function public.admin_set_verification(
  p_user uuid, p_status public.verification_status)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_before public.verification_status; v_name text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();

  select verification_status into v_before from public.profiles where id = p_user;
  select full_name into v_name from public.profiles where id = p_user;
  update public.profiles set verification_status = p_status where id = p_user;

  perform public.log_admin_action(
    case p_status when 'verified' then 'verification.approved'
                  when 'rejected' then 'verification.rejected'
                  else 'verification.updated' end,
    'user', p_user, v_name, jsonb_build_object('from', v_before, 'to', p_status));

  perform public.notify_user(p_user, 'verification_update', 'Verification updated',
    'Your account verification status is now: ' || p_status::text || '.');
end $$;

create or replace function public.admin_suspend_user(
  p_user uuid, p_suspend boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_name text; v_rides int; v_reqs int;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_user = auth.uid() then
    raise exception 'You cannot suspend your own account' using errcode = '22023';
  end if;
  perform public.begin_privileged();

  select full_name into v_name from public.profiles where id = p_user;

  update public.profiles
     set is_suspended = p_suspend,
         suspended_reason = case when p_suspend then nullif(trim(p_reason), '') else null end
   where id = p_user;

  v_rides := 0; v_reqs := 0;
  if p_suspend then
    with c as (update public.rides set status = 'cancelled', cancelled_reason = 'Account suspended'
                where driver_id = p_user and status = 'upcoming' returning 1)
      select count(*) into v_rides from c;
    with c as (update public.ride_requests set status = 'cancelled'
                where rider_id = p_user and status = 'pending' returning 1)
      select count(*) into v_reqs from c;
  end if;

  perform public.log_admin_action(
    case when p_suspend then 'user.suspended' else 'user.reinstated' end,
    'user', p_user, v_name,
    jsonb_build_object('reason', nullif(trim(p_reason), ''),
                       'rides_cancelled', v_rides, 'requests_cancelled', v_reqs));
end $$;

create or replace function public.admin_remove_ride(p_ride uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare rider record; v_dest text; v_label text; v_riders int;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();

  select destination_label into v_dest from public.rides where id = p_ride;
  select origin_label || ' to ' || destination_label into v_label
    from public.rides where id = p_ride;
  select count(*) into v_riders from public.ride_participants
   where ride_id = p_ride and status = 'joined';

  update public.rides
     set status = 'cancelled',
         cancelled_reason = coalesce(nullif(trim(p_reason), ''), 'Removed by moderation')
   where id = p_ride;
  update public.ride_requests set status = 'cancelled'
   where ride_id = p_ride and status in ('pending', 'accepted');

  for rider in select user_id from public.ride_participants where ride_id = p_ride and status = 'joined' loop
    perform public.notify_user(rider.user_id, 'ride_removed', 'Ride cancelled',
      'A ride you joined to ' || coalesce(v_dest, 'a destination') || ' was cancelled by moderation.', p_ride);
  end loop;

  perform public.log_admin_action('ride.cancelled', 'ride', p_ride, v_label,
    jsonb_build_object('reason', nullif(trim(p_reason), ''), 'riders_affected', v_riders));
end $$;

create or replace function public.admin_resolve_report(
  p_report uuid, p_status public.report_status, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_before public.report_status; v_cat text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();

  select status into v_before from public.reports where id = p_report;
  select category into v_cat from public.reports where id = p_report;

  update public.reports
     set status = p_status, admin_notes = nullif(trim(p_notes), ''),
         resolved_by = auth.uid(),
         resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end
   where id = p_report;

  perform public.log_admin_action('report.' || p_status::text, 'report', p_report, v_cat,
    jsonb_build_object('from', v_before, 'to', p_status, 'notes', nullif(trim(p_notes), '')));
end $$;

create or replace function public.admin_set_admin(p_user uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_name text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_user = auth.uid() and not p_is_admin then
    raise exception 'You cannot remove your own admin access' using errcode = '22023';
  end if;
  perform public.begin_privileged();

  select full_name into v_name from public.profiles where id = p_user;
  update public.profiles set is_admin = p_is_admin where id = p_user;

  perform public.log_admin_action(
    case when p_is_admin then 'role.granted_admin' else 'role.revoked_admin' end,
    'user', p_user, v_name, jsonb_build_object('role', case when p_is_admin then 'admin' else 'user' end));
end $$;
