-- ============================================================================
-- 0009  Coordinates + mile-radius search around the pickup point
-- ============================================================================

alter table public.rides
  add column if not exists origin_lat      double precision,
  add column if not exists origin_lng      double precision,
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision,
  add column if not exists geocoded_at     timestamptz;

alter table public.rides
  add constraint rides_origin_lat_range check (origin_lat is null or origin_lat between -90 and 90) not valid;
alter table public.rides
  add constraint rides_origin_lng_range check (origin_lng is null or origin_lng between -180 and 180) not valid;
alter table public.rides validate constraint rides_origin_lat_range;
alter table public.rides validate constraint rides_origin_lng_range;

create index if not exists rides_origin_coords_idx
  on public.rides(origin_lat, origin_lng) where origin_lat is not null;

-- A member's home area, geocoded once, so "near me" works without asking the
-- browser for GPS permission every time.
alter table public.profiles
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision;

-- Great-circle distance in miles.
create or replace function public.miles_between(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision
language sql immutable parallel safe
set search_path = public, pg_temp
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 3958.7613 * 2 * asin(least(1.0, sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians(lng2 - lng1) / 2), 2))))
  end;
$$;

-- One query behind the Find a Ride page.
--
-- SECURITY INVOKER on purpose (the default for `language sql`): Row Level
-- Security still decides which rides the caller may see, so a group-only ride
-- stays invisible to non-members even though this runs server-side.
--
-- Called with no arguments it returns every current listed ride, which is what
-- the page shows on first load.
create or replace function public.search_rides_nearby(
  p_lat              double precision default null,
  p_lng              double precision default null,
  p_radius_miles     double precision default null,
  p_origin           text    default null,
  p_destination      text    default null,
  p_date             date    default null,
  p_time_from        time    default null,
  p_time_to          time    default null,
  p_min_seats        int     default null,
  p_max_contribution numeric default null,
  p_include_full     boolean default true,
  p_limit            int     default 100
)
returns table (
  id uuid, driver_id uuid, origin_label text, origin_area text,
  destination_label text, destination_area text,
  origin_lat double precision, origin_lng double precision,
  depart_date date, depart_time time, depart_at timestamptz,
  seats_offered smallint, seats_taken smallint, seats_remaining smallint,
  contribution_amount numeric, notes text, visibility public.ride_visibility,
  group_id uuid, group_name text, status public.ride_status,
  distance_miles double precision,
  driver_name text, driver_avatar text, driver_rating numeric,
  driver_rating_count integer, driver_rides_completed integer,
  driver_verification public.verification_status
)
language sql stable
set search_path = public, pg_temp
as $$
  with bounds as (
    select case when p_radius_miles is null then null else p_radius_miles / 69.0 end as dlat,
           case when p_radius_miles is null or p_lat is null then null
                else p_radius_miles / (69.0 * greatest(cos(radians(p_lat)), 0.01)) end as dlng
  )
  select r.id, r.driver_id, r.origin_label, r.origin_area,
         r.destination_label, r.destination_area, r.origin_lat, r.origin_lng,
         r.depart_date, r.depart_time, r.depart_at,
         r.seats_offered, r.seats_taken, r.seats_remaining,
         r.contribution_amount, r.notes, r.visibility,
         r.group_id, g.name, r.status,
         public.miles_between(p_lat, p_lng, r.origin_lat, r.origin_lng),
         p.full_name, p.avatar_url, p.rating_avg, p.rating_count,
         p.rides_completed, p.verification_status
    from public.rides r
    join public.profiles p on p.id = r.driver_id
    left join public.trusted_groups g on g.id = r.group_id
    cross join bounds b
   where r.status = 'upcoming'
     and r.is_listed
     and r.depart_at >= now() - interval '30 minutes'
     and (p_origin      is null or p_origin      = '' or r.origin_label      ilike '%' || p_origin || '%')
     and (p_destination is null or p_destination = '' or r.destination_label ilike '%' || p_destination || '%')
     and (p_date      is null or r.depart_date = p_date)
     and (p_time_from is null or r.depart_time >= p_time_from)
     and (p_time_to   is null or r.depart_time <= p_time_to)
     and (p_min_seats is null or r.seats_remaining >= p_min_seats)
     and (p_max_contribution is null or r.contribution_amount <= p_max_contribution)
     and (coalesce(p_include_full, true) or r.seats_remaining > 0)
     and (
       p_lat is null or p_lng is null or p_radius_miles is null
       or (r.origin_lat is not null and r.origin_lng is not null
           -- cheap bounding box first so the index can be used ...
           and r.origin_lat between p_lat - b.dlat and p_lat + b.dlat
           and r.origin_lng between p_lng - b.dlng and p_lng + b.dlng
           -- ... then the exact great-circle check
           and public.miles_between(p_lat, p_lng, r.origin_lat, r.origin_lng) <= p_radius_miles)
     )
   order by public.miles_between(p_lat, p_lng, r.origin_lat, r.origin_lng) asc nulls last,
            r.depart_at asc
   limit least(coalesce(p_limit, 100), 200);
$$;
