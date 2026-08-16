-- ============================================================================
-- 0015  Read APIs behind the admin dashboard
-- ============================================================================
-- Every function re-checks is_admin() itself, so authorisation never depends on
-- the page hiding a link. They are SECURITY DEFINER because they legitimately
-- need to read across all rows (and into auth.users for sign-in times), which
-- RLS would otherwise prevent.

create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users_total',        (select count(*) from public.profiles),
    'users_active',       (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'users_new_7d',       (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'users_suspended',    (select count(*) from public.profiles where is_suspended),
    'users_verified',     (select count(*) from public.profiles where verification_status = 'verified'),
    'users_minors',       (select count(*) from public.profiles where is_minor),
    'minors_no_guardian', (select count(*) from public.profiles p
                            where p.is_minor and not public.has_active_guardian(p.id)),
    'rides_total',        (select count(*) from public.rides),
    'rides_upcoming',     (select count(*) from public.rides where status = 'upcoming'),
    'rides_active',       (select count(*) from public.rides where status = 'active'),
    'rides_completed',    (select count(*) from public.rides where status = 'completed'),
    'rides_cancelled',    (select count(*) from public.rides where status = 'cancelled'),
    'reports_pending',    (select count(*) from public.reports where status = 'open'),
    'reports_reviewing',  (select count(*) from public.reports where status = 'reviewing'),
    'reports_open_total', (select count(*) from public.reports where status in ('open','reviewing')),
    'reports_safety',     (select count(*) from public.reports
                            where status in ('open','reviewing')
                              and category in ('underage_safety','unsafe_driving','harassment')),
    'verification_pending', (select count(*) from public.profiles where verification_status = 'pending'),
    'requests_pending',   (select count(*) from public.ride_requests where status = 'pending'),
    'repeat_offenders',   (select count(*) from (
                              select reported_user_id from public.reports
                               where reported_user_id is not null
                               group by reported_user_id having count(*) > 1) x)
  ) into v;
  return v;
end $$;

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
           coalesce(p.home_area, 'No area set')::text, p.verification_status::text, p.created_at
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
    union all
    select 'verification_requested', 'Verification requested', p.id, p.full_name,
           coalesce(p.home_area, '')::text, p.verification_status::text, p.updated_at
      from public.profiles p where p.verification_status = 'pending'
  ) feed(kind, title, actor_id, actor_name, subject, status, occurred_at)
  order by feed.occurred_at desc
  limit least(coalesce(p_limit, 25), 100);
end $$;

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'profile', to_jsonb(p) - 'is_admin' || jsonb_build_object('is_admin', p.is_admin),
    'email', pv.email, 'phone', pv.phone,
    'last_sign_in_at', u.last_sign_in_at,
    'has_guardian', public.has_active_guardian(p.id),
    'guardians', (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', g.full_name, 'relationship', gr.relationship, 'linked_at', gr.linked_at)), '[]'::jsonb)
                   from public.guardian_relationships gr
                   join public.profiles g on g.id = gr.guardian_id
                  where gr.minor_id = p.id and gr.status = 'active'),
    'counts', jsonb_build_object(
        'rides_posted',    (select count(*) from public.rides where driver_id = p.id),
        'rides_joined',    (select count(*) from public.ride_participants where user_id = p.id and status = 'joined'),
        'rides_completed', p.rides_completed,
        'rides_cancelled', (select count(*) from public.rides where driver_id = p.id and status = 'cancelled'),
        'reports_against', (select count(*) from public.reports where reported_user_id = p.id),
        'reports_filed',   (select count(*) from public.reports where reporter_id = p.id))
  ) into v
  from public.profiles p
  left join public.profiles_private pv on pv.id = p.id
  left join auth.users u on u.id = p.id
  where p.id = p_user;

  if v is null then raise exception 'No such member' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.admin_user_rides(p_user uuid)
returns table (id uuid, relationship text, origin_label text, destination_label text,
               depart_date date, depart_time time, seats_offered smallint,
               seats_remaining smallint, contribution_amount numeric, status public.ride_status)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select r.id, 'Posted'::text, r.origin_label, r.destination_label, r.depart_date, r.depart_time,
           r.seats_offered, r.seats_remaining, r.contribution_amount, r.status
      from public.rides r where r.driver_id = p_user
    union all
    select r.id, 'Joined'::text, r.origin_label, r.destination_label, r.depart_date, r.depart_time,
           r.seats_offered, r.seats_remaining, r.contribution_amount, r.status
      from public.ride_participants rp join public.rides r on r.id = rp.ride_id
     where rp.user_id = p_user and rp.status = 'joined'
    order by 5 desc, 6 desc;
end $$;

create or replace function public.admin_user_reports(p_user uuid)
returns table (id uuid, direction text, category text, details text,
               status public.report_status, other_party text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select r.id, 'Against this member'::text, r.category, r.details, r.status, rp.full_name, r.created_at
      from public.reports r left join public.profiles rp on rp.id = r.reporter_id
     where r.reported_user_id = p_user
    union all
    select r.id, 'Filed by this member'::text, r.category, r.details, r.status, tp.full_name, r.created_at
      from public.reports r left join public.profiles tp on tp.id = r.reported_user_id
     where r.reporter_id = p_user
    order by 7 desc;
end $$;

create or replace function public.admin_rides(
  p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, driver_id uuid, driver_name text, driver_suspended boolean,
               origin_label text, destination_label text, depart_date date, depart_time time,
               depart_at timestamptz, seats_offered smallint, seats_taken smallint,
               seats_remaining smallint, contribution_amount numeric,
               status public.ride_status, visibility public.ride_visibility,
               riders int, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select r.id, r.driver_id, p.full_name, p.is_suspended,
           r.origin_label, r.destination_label, r.depart_date, r.depart_time, r.depart_at,
           r.seats_offered, r.seats_taken, r.seats_remaining, r.contribution_amount,
           r.status, r.visibility,
           (select count(*)::int from public.ride_participants rp
             where rp.ride_id = r.id and rp.status = 'joined'),
           r.created_at
      from public.rides r join public.profiles p on p.id = r.driver_id
     where (p_status is null or p_status = '' or r.status::text = p_status)
       and (p_search is null or p_search = ''
            or p.full_name         ilike '%' || p_search || '%'
            or r.origin_label      ilike '%' || p_search || '%'
            or r.destination_label ilike '%' || p_search || '%')
     order by r.depart_at desc
     limit least(coalesce(p_limit, 200), 500);
end $$;

create or replace function public.admin_ride_detail(p_ride uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'ride', to_jsonb(r),
    'driver', jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
        'rating_avg', p.rating_avg, 'rating_count', p.rating_count,
        'rides_completed', p.rides_completed, 'verification_status', p.verification_status,
        'is_suspended', p.is_suspended),
    'meetup', (select to_jsonb(m) from public.ride_meetups m where m.ride_id = r.id),
    'riders', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', up.id, 'full_name', up.full_name, 'avatar_url', up.avatar_url,
                  'rating_avg', up.rating_avg, 'rating_count', up.rating_count,
                  'verification_status', up.verification_status, 'is_minor', up.is_minor,
                  'seats', rp.seats, 'status', rp.status, 'joined_at', rp.joined_at)
                  order by rp.joined_at), '[]'::jsonb)
                 from public.ride_participants rp
                 join public.profiles up on up.id = rp.user_id
                where rp.ride_id = r.id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', rq.id, 'rider', rup.full_name, 'status', rq.status,
                  'guardian_status', rq.guardian_status, 'created_at', rq.created_at)
                  order by rq.created_at), '[]'::jsonb)
                 from public.ride_requests rq
                 join public.profiles rup on rup.id = rq.rider_id
                where rq.ride_id = r.id)
  ) into v
  from public.rides r join public.profiles p on p.id = r.driver_id
  where r.id = p_ride;

  if v is null then raise exception 'No such ride' using errcode = 'P0002'; end if;
  return v;
end $$;
