-- ============================================================================
-- 0017  Phone numbers exchanged only after acceptance; verification switched off
-- ============================================================================
-- Contact sharing, narrowed to the relationship that needs it:
--
--   the driver -> sees every confirmed rider's number
--   a rider    -> sees the driver's number (and their own row)
--   a guardian -> sees everyone on a ride their minor is confirmed on
--   an admin   -> sees everyone
--
-- Anyone with a pending, rejected or cancelled request sees nothing, and the
-- exception says why. Enforced here, not in the page.

create or replace function public.get_ride_contacts(p_ride_id uuid)
returns table (user_id uuid, full_name text, role text, phone text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me        uuid := auth.uid();
  v_is_driver boolean;
  v_is_rider  boolean;
  v_is_guard  boolean;
  v_is_admin  boolean;
begin
  v_is_driver := public.is_ride_driver(p_ride_id, v_me);
  v_is_rider  := public.is_ride_participant(p_ride_id, v_me);
  v_is_guard  := public.guards_someone_on_ride(p_ride_id, v_me);
  v_is_admin  := public.is_admin(v_me);

  if not (v_is_driver or v_is_rider or v_is_guard or v_is_admin) then
    raise exception 'Contact details are shared once your seat is confirmed'
      using errcode = '42501';
  end if;

  -- The driver is visible to everyone who is on the ride.
  return query
    select p.id, p.full_name, 'driver'::text, pv.phone
      from public.rides r
      join public.profiles p on p.id = r.driver_id
      left join public.profiles_private pv on pv.id = p.id
     where r.id = p_ride_id;

  -- Riders: everyone if you are the driver (or a guardian/admin), otherwise
  -- just yourself, so co-riders do not hand out each other's numbers.
  return query
    select p.id, p.full_name, 'rider'::text, pv.phone
      from public.ride_participants rp
      join public.profiles p on p.id = rp.user_id
      left join public.profiles_private pv on pv.id = p.id
     where rp.ride_id = p_ride_id
       and rp.status = 'joined'
       and (v_is_driver or v_is_guard or v_is_admin or p.id = v_me);
end $$;

grant execute on function public.get_ride_contacts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification is switched off in the product for now, so stop surfacing
-- "verification requested" in the admin activity feed. The verification_status
-- column, admin_set_verification() and request_verification() are deliberately
-- left in place: turning the feature back on is a UI change only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_recent_activity(p_limit int default 25)
returns table (kind text, title text, actor_id uuid, actor_name text,
               subject text, status text, occurred_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
  select * from (
    select 'user_registered'::text, 'New member registered'::text, p.id, p.full_name,
           coalesce(p.home_area, 'No area set')::text, 'joined'::text, p.created_at
      from public.profiles p
    union all
    select 'ride_posted', 'Ride posted', r.driver_id, dp.full_name,
           r.origin_label || ' to ' || r.destination_label, r.status::text, r.created_at
      from public.rides r join public.profiles dp on dp.id = r.driver_id
    union all
    select 'ride_completed', 'Ride completed', r.driver_id, dp.full_name,
           r.origin_label || ' to ' || r.destination_label, r.status::text, r.updated_at
      from public.rides r join public.profiles dp on dp.id = r.driver_id
     where r.status = 'completed'
    union all
    select 'report_submitted', 'Report submitted', rep.reporter_id, rp.full_name,
           rep.category, rep.status::text, rep.created_at
      from public.reports rep join public.profiles rp on rp.id = rep.reporter_id
  ) feed(kind, title, actor_id, actor_name, subject, status, occurred_at)
  order by feed.occurred_at desc
  limit least(coalesce(p_limit, 25), 100);
end $$;
