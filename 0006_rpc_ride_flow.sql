-- ============================================================================
-- 0006  Business logic (RPC)
--       All seat mutations happen here, behind SELECT ... FOR UPDATE on the
--       ride row. Two riders cannot take the same last seat.
-- ============================================================================

create or replace function public.request_to_join(
  p_ride_id uuid, p_message text default null, p_seats smallint default 1)
returns public.ride_requests language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_ride public.rides;
  v_req public.ride_requests;
  v_minor boolean;
  v_guardian uuid;
  v_name text;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  perform public.begin_privileged();

  -- Lock the ride so concurrent requests see a consistent seat count.
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'That ride no longer exists' using errcode = 'P0002'; end if;
  if v_ride.driver_id = v_me then
    raise exception 'You are the driver of this ride' using errcode = '22023'; end if;
  if v_ride.status <> 'upcoming' then
    raise exception 'This ride is no longer accepting riders' using errcode = '22023'; end if;
  if v_ride.depart_at < now() then
    raise exception 'This ride has already departed' using errcode = '22023'; end if;
  if not public.can_participate(v_me) then
    raise exception 'Your account cannot join rides yet. Riders under 18 need a linked parent or guardian.'
      using errcode = '42501'; end if;
  if public.is_blocked_between(v_me, v_ride.driver_id) then
    raise exception 'This ride is not available to you' using errcode = '42501'; end if;
  if v_ride.visibility = 'group' and not public.is_group_member(v_ride.group_id, v_me) then
    raise exception 'This ride is limited to members of a trusted group' using errcode = '42501'; end if;
  if p_seats is null or p_seats < 1 or p_seats > 4 then
    raise exception 'Request between 1 and 4 seats' using errcode = '23514'; end if;
  if v_ride.seats_remaining < p_seats then
    raise exception 'Only % seat(s) left on this ride', v_ride.seats_remaining using errcode = '23514'; end if;

  select p.is_minor, p.full_name into v_minor, v_name from public.profiles p where p.id = v_me;

  if v_minor then
    select gr.guardian_id into v_guardian
      from public.guardian_relationships gr
     where gr.minor_id = v_me and gr.status = 'active'
     order by gr.linked_at nulls last limit 1;
  end if;

  begin
    insert into public.ride_requests
      (ride_id, rider_id, seats_requested, message, guardian_status, guardian_id)
    values (p_ride_id, v_me, p_seats, nullif(trim(p_message), ''),
            case when v_minor then 'pending'::public.guardian_approval
                 else 'not_required'::public.guardian_approval end,
            v_guardian)
    returning * into v_req;
  exception when unique_violation then
    raise exception 'You already have an open request for this ride' using errcode = '23505';
  end;

  perform public.notify_user(v_ride.driver_id, 'request_received', 'New ride request',
    v_name || ' asked to join your ride to ' || v_ride.destination_label,
    v_ride.id, v_req.id, jsonb_build_object('rider_id', v_me));

  if v_guardian is not null then
    perform public.notify_user(v_guardian, 'guardian_approval_needed', 'Approval needed',
      v_name || ' requested a ride to ' || v_ride.destination_label ||
      '. Review it before the driver can accept.',
      v_ride.id, v_req.id, jsonb_build_object('minor_id', v_me));
  end if;

  return v_req;
end $$;

-- ------------------------------------------------- driver accept / reject --
create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns public.ride_requests language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_req public.ride_requests;
  v_ride public.rides;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  perform public.begin_privileged();

  select * into v_req from public.ride_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;

  -- Lock first, re-read after: this is what stops two accepts racing.
  select * into v_ride from public.rides where id = v_req.ride_id for update;
  select * into v_req  from public.ride_requests where id = p_request_id;

  if v_ride.driver_id <> v_me and not public.is_admin() then
    raise exception 'Only the driver can answer this request' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then
    raise exception 'That request was already answered' using errcode = '22023'; end if;

  if p_accept then
    if v_ride.status <> 'upcoming' then
      raise exception 'This ride is no longer active' using errcode = '22023'; end if;
    if v_req.guardian_status = 'pending' then
      raise exception 'This rider is waiting on parent/guardian approval' using errcode = '22023'; end if;
    if v_req.guardian_status = 'denied' then
      raise exception 'This rider''s guardian declined the ride' using errcode = '22023'; end if;
    if v_ride.seats_remaining < v_req.seats_requested then
      raise exception 'Only % seat(s) remain - you cannot accept a request for %.',
        v_ride.seats_remaining, v_req.seats_requested using errcode = '23514'; end if;

    update public.rides set seats_taken = seats_taken + v_req.seats_requested where id = v_ride.id;

    insert into public.ride_participants (ride_id, user_id, request_id, seats, status)
    values (v_ride.id, v_req.rider_id, v_req.id, v_req.seats_requested, 'joined')
    on conflict (ride_id, user_id) do update
      set status = 'joined', seats = excluded.seats,
          request_id = excluded.request_id, left_at = null, joined_at = now();

    update public.ride_requests set status = 'accepted', responded_at = now()
     where id = v_req.id returning * into v_req;

    perform public.notify_user(v_req.rider_id, 'request_accepted', 'You are in!',
      'Your seat on the ride to ' || v_ride.destination_label || ' was confirmed.',
      v_ride.id, v_req.id);

    if v_req.guardian_id is not null then
      perform public.notify_user(v_req.guardian_id, 'ride_confirmed', 'Ride confirmed',
        'A ride you approved has been confirmed by the driver.', v_ride.id, v_req.id);
    end if;
  else
    update public.ride_requests set status = 'rejected', responded_at = now()
     where id = v_req.id returning * into v_req;
    perform public.notify_user(v_req.rider_id, 'request_rejected', 'Request declined',
      'Your request for the ride to ' || v_ride.destination_label ||
      ' was declined. The seat is still open for others.', v_ride.id, v_req.id);
  end if;

  return v_req;
end $$;

-- ------------------------------------------------------- rider withdraws ---
create or replace function public.cancel_request(p_request_id uuid)
returns public.ride_requests language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_req public.ride_requests;
  v_ride public.rides;
begin
  perform public.begin_privileged();
  select * into v_req from public.ride_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_req.rider_id <> v_me and not public.is_guardian_of(v_req.rider_id) and not public.is_admin() then
    raise exception 'You cannot cancel this request' using errcode = '42501'; end if;
  if v_req.status in ('rejected', 'cancelled') then return v_req; end if;

  select * into v_ride from public.rides where id = v_req.ride_id for update;

  if v_req.status = 'accepted' then
    update public.ride_participants set status = 'left', left_at = now()
     where ride_id = v_req.ride_id and user_id = v_req.rider_id and status = 'joined';
    update public.rides set seats_taken = greatest(0, seats_taken - v_req.seats_requested)
     where id = v_ride.id;
    perform public.notify_user(v_ride.driver_id, 'rider_left', 'A rider dropped out',
      'A seat opened back up on your ride to ' || v_ride.destination_label || '.',
      v_ride.id, v_req.id);
  end if;

  update public.ride_requests set status = 'cancelled', responded_at = now()
   where id = v_req.id returning * into v_req;
  return v_req;
end $$;

-- --------------------------------------------------- driver removes rider --
create or replace function public.remove_participant(p_ride_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ride public.rides; v_seats smallint;
begin
  perform public.begin_privileged();
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found' using errcode = 'P0002'; end if;
  if v_ride.driver_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the driver can remove a rider' using errcode = '42501'; end if;

  select seats into v_seats from public.ride_participants
   where ride_id = p_ride_id and user_id = p_user_id and status = 'joined';
  if v_seats is null then return; end if;

  update public.ride_participants set status = 'removed', left_at = now()
   where ride_id = p_ride_id and user_id = p_user_id;
  update public.rides set seats_taken = greatest(0, seats_taken - v_seats) where id = p_ride_id;
  update public.ride_requests set status = 'cancelled'
   where ride_id = p_ride_id and rider_id = p_user_id and status = 'accepted';

  perform public.notify_user(p_user_id, 'removed_from_ride', 'Removed from a ride',
    'The driver removed you from the ride to ' || v_ride.destination_label || '.', p_ride_id);
end $$;

-- ---------------------------------------------------- cancel / complete ----
create or replace function public.cancel_ride(p_ride_id uuid, p_reason text default null)
returns public.rides language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ride public.rides; r record;
begin
  perform public.begin_privileged();
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found' using errcode = 'P0002'; end if;
  if v_ride.driver_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the driver can cancel this ride' using errcode = '42501'; end if;

  update public.rides set status = 'cancelled', cancelled_reason = nullif(trim(p_reason), '')
   where id = p_ride_id returning * into v_ride;
  update public.ride_requests set status = 'cancelled'
   where ride_id = p_ride_id and status in ('pending', 'accepted');

  for r in select user_id from public.ride_participants
            where ride_id = p_ride_id and status = 'joined' loop
    perform public.notify_user(r.user_id, 'ride_cancelled', 'Ride cancelled',
      'The ride to ' || v_ride.destination_label || ' was cancelled by the driver.', p_ride_id);
  end loop;
  return v_ride;
end $$;

create or replace function public.complete_ride(p_ride_id uuid)
returns public.rides language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ride public.rides; r record;
begin
  perform public.begin_privileged();
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found' using errcode = 'P0002'; end if;
  if v_ride.driver_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the driver can complete this ride' using errcode = '42501'; end if;
  if v_ride.status = 'completed' then return v_ride; end if;

  update public.rides set status = 'completed' where id = p_ride_id returning * into v_ride;
  update public.profiles set rides_completed = rides_completed + 1 where id = v_ride.driver_id;

  for r in select user_id from public.ride_participants
            where ride_id = p_ride_id and status = 'joined' loop
    update public.profiles set rides_completed = rides_completed + 1 where id = r.user_id;
    perform public.notify_user(r.user_id, 'ride_completed', 'How was your ride?',
      'Leave a rating for the ride to ' || v_ride.destination_label || '.', p_ride_id);
  end loop;
  return v_ride;
end $$;

-- ------------------------------------------------- contact sharing (safe) --
-- Phone numbers are released only to people actually confirmed on the ride,
-- plus the guardians of any minor on board.
create or replace function public.get_ride_contacts(p_ride_id uuid)
returns table (user_id uuid, full_name text, role text, phone text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if not (public.is_ride_driver(p_ride_id, v_me)
          or public.is_ride_participant(p_ride_id, v_me)
          or public.guards_someone_on_ride(p_ride_id, v_me)
          or public.is_admin(v_me)) then
    raise exception 'Contact details are shared only after a seat is confirmed'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, 'driver'::text, pv.phone
      from public.rides r
      join public.profiles p on p.id = r.driver_id
      left join public.profiles_private pv on pv.id = p.id
     where r.id = p_ride_id
    union all
    select p.id, p.full_name, 'rider'::text, pv.phone
      from public.ride_participants rp
      join public.profiles p on p.id = rp.user_id
      left join public.profiles_private pv on pv.id = p.id
     where rp.ride_id = p_ride_id and rp.status = 'joined';
end $$;

grant execute on function public.request_to_join(uuid, text, smallint) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean)     to authenticated;
grant execute on function public.cancel_request(uuid)                  to authenticated;
grant execute on function public.remove_participant(uuid, uuid)        to authenticated;
grant execute on function public.cancel_ride(uuid, text)               to authenticated;
grant execute on function public.complete_ride(uuid)                   to authenticated;
grant execute on function public.get_ride_contacts(uuid)               to authenticated;
