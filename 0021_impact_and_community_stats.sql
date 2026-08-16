-- ============================================================================
-- 0021  Honest impact numbers
-- ============================================================================
-- Everything here is derived from completed rides. Nothing is estimated unless
-- it says so, and where there is not enough data the caller gets zeros so the
-- interface can say "not enough yet" rather than print a wall of noughts.
--
-- Distance is only counted for rides that were geocoded at posting time; the
-- functions also return how many rides that covers, so the UI can be honest
-- about the sample it measured.
--
-- CO2: 0.4 kg per vehicle-mile is the widely used figure for an average petrol
-- car (US EPA puts tailpipe CO2 at roughly 400 g/mile). Each rider who shares a
-- ride is treated as one car journey not made.

create or replace function public.my_impact()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;

  with mine as (
    -- every completed ride I was on, and which side I was on
    select r.id, r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng,
           r.contribution_amount, r.seats_taken, true as as_driver
      from public.rides r
     where r.driver_id = v_me and r.status = 'completed'
    union all
    select r.id, r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng,
           r.contribution_amount, r.seats_taken, false
      from public.ride_participants rp
      join public.rides r on r.id = rp.ride_id
     where rp.user_id = v_me and rp.status = 'joined' and r.status = 'completed'
  ),
  measured as (
    select *, public.miles_between(origin_lat, origin_lng, destination_lat, destination_lng) as miles
      from mine
  )
  select jsonb_build_object(
    'rides_shared',   (select count(*) from mine),
    'as_driver',      (select count(*) from mine where as_driver),
    'as_rider',       (select count(*) from mine where not as_driver),
    -- seats I personally gave to other people
    'seats_given',    (select coalesce(sum(seats_taken), 0) from mine where as_driver),
    -- rides where we know the distance, so the UI can caveat the estimate
    'rides_measured', (select count(*) from measured where miles is not null),
    'miles_shared',   (select round(coalesce(sum(miles), 0)::numeric, 1) from measured where miles is not null),
    -- car journeys not made: as a driver, one per rider; as a rider, my own
    'trips_avoided',  (select coalesce(sum(case when as_driver then seats_taken else 1 end), 0) from mine),
    'co2_kg',         (select round(coalesce(sum(
                          miles * case when as_driver then seats_taken else 1 end * 0.4), 0)::numeric, 1)
                        from measured where miles is not null),
    'contributions',  (select round(coalesce(sum(contribution_amount), 0)::numeric, 2)
                        from mine where not as_driver)
  ) into v;
  return v;
end $$;

-- Public-safe totals for the landing page. No personal data, and the caller
-- decides whether the numbers are big enough to be worth showing.
create or replace function public.community_stats()
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'members',        (select count(*) from public.profiles where not is_suspended),
    'rides_shared',   (select count(*) from public.rides where status = 'completed'),
    'seats_filled',   (select coalesce(sum(seats_taken), 0) from public.rides where status = 'completed'),
    'rides_upcoming', (select count(*) from public.rides where status = 'upcoming'),
    'rides_30d',      (select count(*) from public.rides
                        where status = 'completed' and depart_at >= now() - interval '30 days'),
    'co2_kg',         (select round(coalesce(sum(
                          public.miles_between(origin_lat, origin_lng, destination_lat, destination_lng)
                          * seats_taken * 0.4), 0)::numeric, 0)
                        from public.rides where status = 'completed')
  );
$$;

grant execute on function public.my_impact()       to authenticated;
grant execute on function public.community_stats() to authenticated, anon;
