-- ============================================================================
-- 0023  The driver confirms the same notice before taking someone in their car
-- ============================================================================
-- Admins acting on a member's behalf are exempt, so moderation still works.
-- Declining never requires a confirmation.

create or replace function public.respond_to_request(
  p_request_id uuid, p_accept boolean, p_ack_version text default null)
returns public.ride_requests language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_req public.ride_requests;
  v_ride public.rides;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;

  if p_accept and not public.is_admin()
     and (p_ack_version is null or char_length(trim(p_ack_version)) = 0) then
    raise exception 'Please read and confirm the safety notice before accepting a rider'
      using errcode = '42501';
  end if;

  perform public.begin_privileged();

  select * into v_req from public.ride_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;

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

    if p_ack_version is not null then
      perform public.record_safety_ack(v_ride.id, 'driver', p_ack_version, 'accept_rider');
    end if;

    perform public.add_conversation_member(v_ride.id, v_req.rider_id);

    perform public.notify_user(v_req.rider_id, 'request_accepted', 'You are in!',
      'Your seat on the ride to ' || v_ride.destination_label ||
      ' was confirmed. You can message your driver now.', v_ride.id, v_req.id);

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

drop function if exists public.respond_to_request(uuid, boolean);
grant execute on function public.respond_to_request(uuid, boolean, text) to authenticated;
