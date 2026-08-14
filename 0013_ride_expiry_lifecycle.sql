-- ============================================================================
-- 0013  Rides close themselves once their departure time passes
-- ============================================================================
-- Two stages, both run by pg_cron so they happen whether or not anybody has the
-- site open:
--
--   depart_at            upcoming -> active     listing closes, driver told,
--                                               unanswered requests closed
--   depart_at + 12 hours active   -> completed  ratings unlock
--
-- Search already hides anything that is not 'upcoming', so moving the status is
-- what actually removes the listing.

create extension if not exists pg_cron;

create or replace function public.close_departed_rides()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            record;
  rider        record;
  v_pending    int;
  v_seated     int;
  v_closed     int := 0;
  v_completed  int := 0;
  v_notified   int := 0;
begin
  perform public.begin_privileged();

  -- ---------------------------------------------------------- stage 1 ----
  -- Departure time has arrived: the ride is under way, so it stops being a
  -- listing. `skip locked` keeps this safe if two runs ever overlap.
  for r in
    select * from public.rides
     where status = 'upcoming' and depart_at <= now()
     order by depart_at
     for update skip locked
  loop
    select count(*) into v_pending
      from public.ride_requests
     where ride_id = r.id and status = 'pending';

    select coalesce(sum(seats), 0) into v_seated
      from public.ride_participants
     where ride_id = r.id and status = 'joined';

    update public.rides set status = 'active' where id = r.id;
    v_closed := v_closed + 1;

    -- Anyone still waiting on an answer never got one. Close their request and
    -- tell them, rather than leaving it pending forever.
    for rider in
      select id, rider_id from public.ride_requests
       where ride_id = r.id and status = 'pending'
    loop
      update public.ride_requests
         set status = 'cancelled', responded_at = now()
       where id = rider.id;

      perform public.notify_user(
        rider.rider_id, 'request_expired', 'That ride has set off',
        'Your request for the ride to ' || r.destination_label ||
        ' expired because it departed before your driver answered.',
        r.id, rider.id);
      v_notified := v_notified + 1;
    end loop;

    -- Tell the person who posted it.
    perform public.notify_user(
      r.driver_id, 'ride_departed', 'Your ride listing has closed',
      'Your ride from ' || r.origin_label || ' to ' || r.destination_label ||
      ' has reached its departure time, so it is no longer listed.' ||
      case when v_seated > 0
           then ' ' || v_seated || ' rider' || case when v_seated = 1 then '' else 's' end ||
                ' travelling with you. Mark it completed when you are back so everyone can leave a rating.'
           else ' Nobody joined this one.' end ||
      case when v_pending > 0
           then ' ' || v_pending || ' unanswered request' ||
                case when v_pending = 1 then ' was' else 's were' end || ' closed automatically.'
           else '' end,
      r.id);
    v_notified := v_notified + 1;
  end loop;

  -- ---------------------------------------------------------- stage 2 ----
  -- Long after departure, wrap the ride up so ratings become available. This
  -- mirrors complete_ride() exactly, including the completed-ride counters.
  for r in
    select * from public.rides
     where status = 'active' and depart_at <= now() - interval '12 hours'
     order by depart_at
     for update skip locked
  loop
    update public.rides set status = 'completed' where id = r.id;
    update public.profiles set rides_completed = rides_completed + 1 where id = r.driver_id;
    v_completed := v_completed + 1;

    for rider in
      select user_id from public.ride_participants
       where ride_id = r.id and status = 'joined'
    loop
      update public.profiles set rides_completed = rides_completed + 1 where id = rider.user_id;
      perform public.notify_user(
        rider.user_id, 'ride_completed', 'How was your ride?',
        'Your ride to ' || r.destination_label || ' is finished. Leave a rating for the people you travelled with.',
        r.id);
      v_notified := v_notified + 1;
    end loop;

    perform public.notify_user(
      r.driver_id, 'ride_completed', 'Ride wrapped up',
      'Your ride to ' || r.destination_label || ' has been marked completed. You can rate your riders now.',
      r.id);
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ran_at', now(),
    'listings_closed', v_closed,
    'rides_completed', v_completed,
    'notifications_sent', v_notified);
end $$;

-- Only the scheduler and administrators may run it.
revoke all on function public.close_departed_rides() from public, anon, authenticated;

create or replace function public.admin_close_departed_rides()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  return public.close_departed_rides();
end $$;

grant execute on function public.admin_close_departed_rides() to authenticated;

-- Every five minutes: fine-grained enough that a listing never lingers long,
-- cheap enough to be irrelevant.
select cron.unschedule('close-departed-rides')
 where exists (select 1 from cron.job where jobname = 'close-departed-rides');

select cron.schedule('close-departed-rides', '*/5 * * * *',
                     $$select public.close_departed_rides();$$);
