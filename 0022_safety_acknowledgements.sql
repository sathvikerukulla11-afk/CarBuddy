-- ============================================================================
-- 0022  Recorded safety acknowledgements
-- ============================================================================
-- Before a rider asks for a seat, and before a driver accepts one, each person
-- confirms they have read the safety notice. The confirmation is recorded here
-- with a version and a timestamp.
--
-- The record is the point. A line of text in a modal proves nothing later; a
-- timestamped row saying "this person confirmed version 2026-08-a at 14:22" is
-- evidence. Versioning means updating the notice does not silently appear to
-- cover people who only ever saw the old wording.

create table if not exists public.safety_acknowledgements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  ride_id    uuid references public.rides(id) on delete set null,
  role       text not null check (role in ('rider', 'driver')),
  version    text not null,
  context    text,                     -- 'request_seat' | 'accept_rider'
  created_at timestamptz not null default now()
);

create index if not exists safety_ack_user_idx on public.safety_acknowledgements(user_id, created_at desc);
create index if not exists safety_ack_ride_idx on public.safety_acknowledgements(ride_id);

alter table public.safety_acknowledgements enable row level security;

drop policy if exists safety_ack_select on public.safety_acknowledgements;
create policy safety_ack_select on public.safety_acknowledgements
  for select to authenticated
  using (user_id = (select auth.uid())
         or public.is_guardian_of(user_id)
         or public.is_admin());

-- No insert policy: written only by the server, so it cannot be back-dated or
-- forged by a client.
grant select on public.safety_acknowledgements to authenticated;

create or replace function public.record_safety_ack(
  p_ride uuid, p_role text, p_version text, p_context text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.safety_acknowledgements (user_id, ride_id, role, version, context)
  values (auth.uid(), p_ride, p_role, p_version, p_context);
end $$;

revoke all on function public.record_safety_ack(uuid, text, text, text)
  from public, anon, authenticated;

-- request_to_join() and respond_to_request() are redefined in this migration
-- and 0023 to require the acknowledgement. The old signatures are dropped so
-- there is no remaining way to reach the flow without confirming.

-- ------------------------------------------ require it before requesting ----
create or replace function public.request_to_join(
  p_ride_id uuid, p_message text default null, p_seats smallint default 1,
  p_ack_version text default null)
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
  if p_ack_version is null or char_length(trim(p_ack_version)) = 0 then
    raise exception 'Please read and confirm the safety notice before asking for a seat'
      using errcode = '42501';
  end if;

  perform public.begin_privileged();

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

  perform public.record_safety_ack(p_ride_id, 'rider', p_ack_version, 'request_seat');

  perform public.notify_user(
    v_ride.driver_id, 'request_received', 'New ride request',
    v_name || ' asked to join your ride to ' || v_ride.destination_label,
    v_ride.id, v_req.id, jsonb_build_object('rider_id', v_me));

  if v_guardian is not null then
    perform public.notify_user(
      v_guardian, 'guardian_approval_needed', 'Approval needed',
      v_name || ' requested a ride to ' || v_ride.destination_label ||
      '. Review it before the driver can accept.',
      v_ride.id, v_req.id, jsonb_build_object('minor_id', v_me));
  end if;

  return v_req;
end $$;

-- the old three-argument form is no longer a valid way in
drop function if exists public.request_to_join(uuid, text, smallint);
grant execute on function public.request_to_join(uuid, text, smallint, text) to authenticated;
