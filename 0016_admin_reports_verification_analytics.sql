-- ============================================================================
-- 0016  Reports queue, verification queue, analytics, action log
-- ============================================================================

create or replace function public.admin_reports(p_status text default null)
returns table (id uuid, category text, details text, status public.report_status,
               admin_notes text, created_at timestamptz, resolved_at timestamptz,
               reporter_id uuid, reporter_name text,
               reported_id uuid, reported_name text, reported_suspended boolean,
               reported_rating numeric, reported_verification public.verification_status,
               reported_prior_reports int, ride_id uuid, ride_label text, is_safety boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select r.id, r.category, r.details, r.status, r.admin_notes, r.created_at, r.resolved_at,
           r.reporter_id, rp.full_name,
           r.reported_user_id, tp.full_name, tp.is_suspended, tp.rating_avg, tp.verification_status,
           (select count(*)::int from public.reports pr
             where pr.reported_user_id = r.reported_user_id and pr.id <> r.id),
           r.ride_id,
           (select rd.origin_label || ' to ' || rd.destination_label
              from public.rides rd where rd.id = r.ride_id),
           (r.category in ('underage_safety', 'unsafe_driving', 'harassment'))
      from public.reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles tp on tp.id = r.reported_user_id
     where p_status is null or p_status = '' or r.status::text = p_status
     order by (r.status = 'open') desc,
              (r.category in ('underage_safety','unsafe_driving','harassment')) desc,
              r.created_at desc
     limit 300;
end $$;

create or replace function public.admin_report_detail(p_report uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb; v_target uuid;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select reported_user_id into v_target from public.reports where id = p_report;

  select jsonb_build_object(
    'report', to_jsonb(r),
    'reporter', (select jsonb_build_object('id', x.id, 'full_name', x.full_name,
                    'avatar_url', x.avatar_url, 'rating_avg', x.rating_avg,
                    'verification_status', x.verification_status)
                   from public.profiles x where x.id = r.reporter_id),
    'reported', (select jsonb_build_object('id', x.id, 'full_name', x.full_name,
                    'avatar_url', x.avatar_url, 'rating_avg', x.rating_avg,
                    'rating_count', x.rating_count, 'rides_completed', x.rides_completed,
                    'verification_status', x.verification_status, 'is_suspended', x.is_suspended,
                    'is_minor', x.is_minor, 'created_at', x.created_at)
                   from public.profiles x where x.id = r.reported_user_id),
    'ride', (select jsonb_build_object('id', rd.id, 'origin_label', rd.origin_label,
                'destination_label', rd.destination_label, 'depart_date', rd.depart_date,
                'depart_time', rd.depart_time, 'status', rd.status)
               from public.rides rd where rd.id = r.ride_id),
    'prior_reports', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', pr.id, 'category', pr.category, 'status', pr.status,
                        'created_at', pr.created_at) order by pr.created_at desc), '[]'::jsonb)
                       from public.reports pr
                      where pr.reported_user_id = v_target and pr.id <> p_report),
    'reported_rides', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', rd.id, 'route', rd.origin_label || ' to ' || rd.destination_label,
                        'depart_date', rd.depart_date, 'status', rd.status)
                        order by rd.depart_at desc), '[]'::jsonb)
                       from public.rides rd where rd.driver_id = v_target)
  ) into v
  from public.reports r where r.id = p_report;

  if v is null then raise exception 'No such report' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.admin_verification_queue(p_status text default 'pending')
returns table (id uuid, full_name text, avatar_url text, email text, phone text,
               age_category public.age_category, is_minor boolean, has_guardian boolean,
               verification_status public.verification_status, home_area text,
               rides_completed int, rating_avg numeric,
               submitted_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, p.avatar_url, pv.email, pv.phone,
           p.age_category, p.is_minor, public.has_active_guardian(p.id),
           p.verification_status, p.home_area, p.rides_completed, p.rating_avg,
           p.updated_at, p.created_at
      from public.profiles p
      left join public.profiles_private pv on pv.id = p.id
     where p_status is null or p_status = '' or p.verification_status::text = p_status
     order by p.updated_at desc
     limit 300;
end $$;

create or replace function public.admin_analytics(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb; v_days int := greatest(least(coalesce(p_days, 30), 365), 7);
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  with days as (
    select generate_series((current_date - (v_days - 1))::date, current_date, interval '1 day')::date as d
  )
  select jsonb_build_object(
    'window_days', v_days,
    'series', (select jsonb_agg(jsonb_build_object(
                 'date', d.d,
                 'users',     (select count(*) from public.profiles p where p.created_at::date = d.d),
                 'rides',     (select count(*) from public.rides r where r.created_at::date = d.d),
                 'completed', (select count(*) from public.rides r where r.status = 'completed' and r.depart_at::date = d.d),
                 'cancelled', (select count(*) from public.rides r where r.status = 'cancelled' and r.depart_at::date = d.d),
                 'reports',   (select count(*) from public.reports rep where rep.created_at::date = d.d)
               ) order by d.d) from days d),
    'totals', jsonb_build_object(
        'rides',      (select count(*) from public.rides),
        'finished',   (select count(*) from public.rides where status in ('completed','cancelled')),
        'completed',  (select count(*) from public.rides where status = 'completed'),
        'cancelled',  (select count(*) from public.rides where status = 'cancelled'),
        'seats_offered', (select coalesce(sum(seats_offered), 0) from public.rides),
        'seats_taken',   (select coalesce(sum(seats_taken), 0) from public.rides)),
    'completion_rate', (select case when count(*) filter (where status in ('completed','cancelled')) = 0
                                    then null
                                    else round(100.0 * count(*) filter (where status = 'completed')
                                             / count(*) filter (where status in ('completed','cancelled')), 1) end
                          from public.rides),
    'avg_riders_per_ride', (select case when count(*) = 0 then null
                                        else round(avg(seats_taken)::numeric, 2) end from public.rides),
    'avg_seats_available', (select case when count(*) = 0 then null
                                        else round(avg(seats_remaining)::numeric, 2) end from public.rides),
    'top_routes', (select coalesce(jsonb_agg(jsonb_build_object(
                            'route', route, 'rides', c, 'seats_filled', filled)
                          order by c desc, filled desc), '[]'::jsonb)
                     from (select origin_label || ' to ' || destination_label as route,
                                  count(*) as c, coalesce(sum(seats_taken), 0) as filled
                             from public.rides
                            group by origin_label, destination_label
                            order by count(*) desc limit 6) t),
    'busiest_hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', hr, 'rides', c)
                              order by hr), '[]'::jsonb)
                        from (select extract(hour from depart_time)::int as hr, count(*) as c
                                from public.rides group by 1) t),
    'busiest_days', (select coalesce(jsonb_agg(jsonb_build_object('dow', dw, 'rides', c)
                             order by dw), '[]'::jsonb)
                       from (select extract(dow from depart_date)::int as dw, count(*) as c
                               from public.rides group by 1) t)
  ) into v;
  return v;
end $$;

create or replace function public.admin_action_log(p_limit int default 100)
returns table (id uuid, admin_id uuid, admin_name text, action text,
               target_type text, target_id uuid, target_label text,
               details jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select a.id, a.admin_id, coalesce(p.full_name, 'Removed account'), a.action,
           a.target_type, a.target_id, a.target_label, a.details, a.created_at
      from public.admin_actions a
      left join public.profiles p on p.id = a.admin_id
     order by a.created_at desc
     limit least(coalesce(p_limit, 100), 500);
end $$;

grant execute on function public.admin_overview()               to authenticated;
grant execute on function public.admin_recent_activity(int)     to authenticated;
grant execute on function public.admin_user_detail(uuid)        to authenticated;
grant execute on function public.admin_user_rides(uuid)         to authenticated;
grant execute on function public.admin_user_reports(uuid)       to authenticated;
grant execute on function public.admin_rides(text, text, int)   to authenticated;
grant execute on function public.admin_ride_detail(uuid)        to authenticated;
grant execute on function public.admin_reports(text)            to authenticated;
grant execute on function public.admin_report_detail(uuid)      to authenticated;
grant execute on function public.admin_verification_queue(text) to authenticated;
grant execute on function public.admin_analytics(int)           to authenticated;
grant execute on function public.admin_action_log(int)          to authenticated;
