-- ============================================================================
-- 0007  Guardian linking + approval, ratings, group joining, admin actions
-- ============================================================================

-- ------------------------------------------------------- guardian linking --
-- The minor generates a code; a guardian redeems it from their own account.
create or replace function public.create_guardian_invite()
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_code text;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  select invite_code into v_code from public.guardian_relationships
   where minor_id = v_me and status = 'pending' order by created_at desc limit 1;
  if v_code is not null then return v_code; end if;
  v_code := public.random_code(6);
  insert into public.guardian_relationships (minor_id, status, invite_code)
  values (v_me, 'pending', v_code);
  return v_code;
end $$;

create or replace function public.claim_guardian_invite(
  p_code text, p_relationship text default 'Parent/Guardian')
returns public.guardian_relationships
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_rel public.guardian_relationships;
  v_minor_name text; v_my_name text;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  perform public.begin_privileged();

  select * into v_rel from public.guardian_relationships
   where upper(invite_code) = upper(trim(p_code)) and status = 'pending' for update;
  if not found then
    raise exception 'That code is not valid or has already been used' using errcode = 'P0002'; end if;
  if v_rel.minor_id = v_me then
    raise exception 'You cannot be your own guardian' using errcode = '22023'; end if;
  if (select is_minor from public.profiles where id = v_me) then
    raise exception 'A guardian account must be 18 or older' using errcode = '42501'; end if;

  update public.guardian_relationships
     set guardian_id = v_me, status = 'active', linked_at = now(),
         relationship = nullif(trim(p_relationship), ''), invite_code = null
   where id = v_rel.id returning * into v_rel;

  select full_name into v_minor_name from public.profiles where id = v_rel.minor_id;
  select full_name into v_my_name    from public.profiles where id = v_me;

  -- Any request the minor already opened now needs this guardian's decision.
  update public.ride_requests set guardian_id = v_me, guardian_status = 'pending'
   where rider_id = v_rel.minor_id and status = 'pending' and guardian_status <> 'approved';

  perform public.notify_user(v_rel.minor_id, 'guardian_linked', 'Guardian linked',
    v_my_name || ' is now linked to your account and will approve your rides.');
  return v_rel;
end $$;

create or replace function public.revoke_guardian_link(p_relationship_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_rel public.guardian_relationships;
begin
  perform public.begin_privileged();
  select * into v_rel from public.guardian_relationships where id = p_relationship_id;
  if not found then return; end if;
  -- Deliberately not permitted for the minor: only the guardian or an admin.
  if v_rel.guardian_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the guardian can remove this link' using errcode = '42501'; end if;
  update public.guardian_relationships set status = 'revoked', revoked_at = now()
   where id = p_relationship_id;
end $$;

-- --------------------------------------------------- guardian ride decision --
create or replace function public.guardian_decide_request(
  p_request_id uuid, p_approve boolean, p_note text default null)
returns public.ride_requests language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_req public.ride_requests; v_ride public.rides;
begin
  perform public.begin_privileged();
  select * into v_req from public.ride_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if not public.is_guardian_of(v_req.rider_id, v_me) and not public.is_admin() then
    raise exception 'You are not the linked guardian for this rider' using errcode = '42501'; end if;

  select * into v_ride from public.rides where id = v_req.ride_id;

  update public.ride_requests
     set guardian_status = case when p_approve then 'approved' else 'denied' end::public.guardian_approval,
         guardian_id = coalesce(v_req.guardian_id, v_me),
         guardian_note = nullif(trim(p_note), ''),
         guardian_decided_at = now(),
         status = case when p_approve then v_req.status else 'cancelled'::public.request_status end
   where id = p_request_id returning * into v_req;

  if p_approve then
    perform public.notify_user(v_ride.driver_id, 'guardian_approved', 'Guardian approved a rider',
      'A guardian approved a rider for your ride to ' || v_ride.destination_label ||
      '. You can accept them now.', v_ride.id, v_req.id);
    perform public.notify_user(v_req.rider_id, 'guardian_approved', 'Your guardian approved this ride',
      'Waiting for the driver to confirm your seat.', v_ride.id, v_req.id);
  else
    perform public.notify_user(v_req.rider_id, 'guardian_denied', 'Your guardian declined this ride',
      coalesce(nullif(trim(p_note), ''), 'Talk with them about other options.'), v_ride.id, v_req.id);
  end if;
  return v_req;
end $$;

-- ---------------------------------------------------------------- ratings --
create or replace function public.rate_user(
  p_ride_id uuid, p_ratee_id uuid, p_stars smallint, p_comment text default null)
returns public.ratings language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_ride public.rides; v_rating public.ratings; v_ok boolean;
begin
  perform public.begin_privileged();
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Rating must be between 1 and 5 stars' using errcode = '23514'; end if;
  if v_me = p_ratee_id then
    raise exception 'You cannot rate yourself' using errcode = '22023'; end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found then raise exception 'Ride not found' using errcode = 'P0002'; end if;
  if v_ride.status <> 'completed' then
    raise exception 'You can rate people once the ride is marked completed' using errcode = '22023'; end if;

  -- Both people must actually have been on this ride.
  v_ok := (public.is_ride_driver(p_ride_id, v_me) or public.is_ride_participant(p_ride_id, v_me))
      and (public.is_ride_driver(p_ride_id, p_ratee_id) or public.is_ride_participant(p_ride_id, p_ratee_id));
  if not v_ok then
    raise exception 'You can only rate people you actually shared this ride with' using errcode = '42501'; end if;

  begin
    insert into public.ratings (ride_id, rater_id, ratee_id, stars, comment)
    values (p_ride_id, v_me, p_ratee_id, p_stars, nullif(trim(p_comment), ''))
    returning * into v_rating;
  exception when unique_violation then
    raise exception 'You already rated this person for this ride' using errcode = '23505';
  end;

  perform public.notify_user(p_ratee_id, 'new_rating', 'You received a rating',
    p_stars || '-star rating from a recent ride.', p_ride_id);
  return v_rating;
end $$;

-- ----------------------------------------------------------- group joining --
create or replace function public.join_group_by_code(p_code text)
returns public.trusted_groups language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_group public.trusted_groups;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  select * into v_group from public.trusted_groups where upper(join_code) = upper(trim(p_code));
  if not found then raise exception 'No trusted group matches that code' using errcode = 'P0002'; end if;

  insert into public.group_members (group_id, user_id, status)
  values (v_group.id, v_me,
          case when v_group.is_open then 'active' else 'pending' end::public.member_status)
  on conflict (group_id, user_id) do update
    set status = case when v_group.is_open then 'active'::public.member_status
                      else group_members.status end;

  if not v_group.is_open then
    perform public.notify_user(v_group.created_by, 'group_join_request',
      'New group join request', 'Someone asked to join ' || v_group.name || '.');
  end if;
  return v_group;
end $$;

create or replace function public.set_group_member_status(
  p_group uuid, p_user uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_group_admin(p_group) and not public.is_admin() then
    raise exception 'Only a group admin can do that' using errcode = '42501'; end if;
  update public.group_members set status = p_status where group_id = p_group and user_id = p_user;
  if p_status = 'active' then
    perform public.notify_user(p_user, 'group_approved', 'Trusted group approved',
      'You were added to a trusted group.');
  end if;
end $$;

-- ------------------------------------------------------------ admin tools --
create or replace function public.admin_set_verification(
  p_user uuid, p_status public.verification_status)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();
  update public.profiles set verification_status = p_status where id = p_user;
  perform public.notify_user(p_user, 'verification_update', 'Verification updated',
    'Your account verification status is now: ' || p_status::text || '.');
end $$;

create or replace function public.admin_suspend_user(
  p_user uuid, p_suspend boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();
  update public.profiles
     set is_suspended = p_suspend,
         suspended_reason = case when p_suspend then nullif(trim(p_reason), '') else null end
   where id = p_user;
  if p_suspend then
    update public.rides set status = 'cancelled', cancelled_reason = 'Account suspended'
     where driver_id = p_user and status = 'upcoming';
    update public.ride_requests set status = 'cancelled'
     where rider_id = p_user and status = 'pending';
  end if;
end $$;

create or replace function public.admin_remove_ride(p_ride uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_dest text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();
  select destination_label into v_dest from public.rides where id = p_ride;
  update public.rides
     set status = 'cancelled',
         cancelled_reason = coalesce(nullif(trim(p_reason), ''), 'Removed by moderation')
   where id = p_ride;
  update public.ride_requests set status = 'cancelled'
   where ride_id = p_ride and status in ('pending', 'accepted');
  for r in select user_id from public.ride_participants where ride_id = p_ride and status = 'joined' loop
    perform public.notify_user(r.user_id, 'ride_removed', 'Ride removed',
      'A ride you joined to ' || coalesce(v_dest, 'a destination') ||
      ' was removed by moderation.', p_ride);
  end loop;
end $$;

create or replace function public.admin_resolve_report(
  p_report uuid, p_status public.report_status, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.begin_privileged();
  update public.reports
     set status = p_status, admin_notes = nullif(trim(p_notes), ''),
         resolved_by = auth.uid(),
         resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end
   where id = p_report;
end $$;

-- Admin-only overview counts for the dashboard header.
create or replace function public.admin_stats()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users',            (select count(*) from public.profiles),
    'users_suspended',  (select count(*) from public.profiles where is_suspended),
    'users_pending_verification', (select count(*) from public.profiles where verification_status = 'pending'),
    'minors',           (select count(*) from public.profiles where is_minor),
    'rides_total',      (select count(*) from public.rides),
    'rides_upcoming',   (select count(*) from public.rides where status = 'upcoming'),
    'reports_open',     (select count(*) from public.reports where status in ('open', 'reviewing')),
    'requests_pending', (select count(*) from public.ride_requests where status = 'pending')
  ) into v;
  return v;
end $$;

-- Admin listing of users with their private contact rows joined.
create or replace function public.admin_list_users(p_search text default null, p_limit int default 100)
returns table (
  id uuid, full_name text, email text, phone text, age_category public.age_category,
  is_minor boolean, verification_status public.verification_status, is_admin boolean,
  is_suspended boolean, rating_avg numeric, rating_count int, rides_completed int,
  has_guardian boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, pv.email, pv.phone, p.age_category, p.is_minor,
           p.verification_status, p.is_admin, p.is_suspended,
           p.rating_avg, p.rating_count, p.rides_completed,
           public.has_active_guardian(p.id), p.created_at
      from public.profiles p
      left join public.profiles_private pv on pv.id = p.id
     where p_search is null or p_search = ''
        or p.full_name ilike '%' || p_search || '%'
        or pv.email    ilike '%' || p_search || '%'
     order by p.created_at desc
     limit least(coalesce(p_limit, 100), 500);
end $$;

grant execute on function public.create_guardian_invite()                                  to authenticated;
grant execute on function public.claim_guardian_invite(text, text)                         to authenticated;
grant execute on function public.revoke_guardian_link(uuid)                                to authenticated;
grant execute on function public.guardian_decide_request(uuid, boolean, text)              to authenticated;
grant execute on function public.rate_user(uuid, uuid, smallint, text)                     to authenticated;
grant execute on function public.join_group_by_code(text)                                  to authenticated;
grant execute on function public.set_group_member_status(uuid, uuid, public.member_status) to authenticated;
grant execute on function public.admin_set_verification(uuid, public.verification_status)  to authenticated;
grant execute on function public.admin_suspend_user(uuid, boolean, text)                   to authenticated;
grant execute on function public.admin_remove_ride(uuid, text)                             to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status, text)    to authenticated;
grant execute on function public.admin_stats()                                             to authenticated;
grant execute on function public.admin_list_users(text, int)                               to authenticated;
