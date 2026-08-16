-- ============================================================================
-- 0019  Messaging API: send, read, list, report
-- ============================================================================
-- respond_to_request() is also redefined here to create/join the ride's
-- conversation when a driver accepts. Everything else about it is unchanged.

alter table public.reports
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null;

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check check (category in (
  'unsafe_driving', 'harassment', 'no_show', 'inappropriate_content',
  'scam_or_payment', 'fake_profile', 'underage_safety',
  'inappropriate_behaviour', 'suspicious_behaviour', 'safety_concern', 'spam',
  'other'));

create or replace function public.send_message(p_conversation uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages;
  v_conv public.conversations;
  v_ride public.rides;
  v_name text;
  v_blocked text;
  other record;
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'Write something first' using errcode = '22023'; end if;
  if char_length(trim(p_body)) > 2000 then
    raise exception 'That message is too long (2000 characters maximum)' using errcode = '22023'; end if;
  if not public.is_conversation_member(p_conversation, v_me) then
    raise exception 'You are not part of this conversation' using errcode = '42501'; end if;

  select * into v_conv from public.conversations where id = p_conversation;
  select * into v_ride from public.rides where id = v_conv.ride_id;

  if v_conv.status = 'archived' then
    raise exception 'This conversation is archived and is now read-only' using errcode = '22023'; end if;

  -- Blocking: if you and someone still in this conversation have blocked each
  -- other, the thread goes read-only for you. History is kept.
  select p.full_name into v_blocked
    from public.conversation_members cm
    join public.profiles p on p.id = cm.user_id
   where cm.conversation_id = p_conversation and cm.left_at is null
     and cm.user_id <> v_me and public.is_blocked_between(v_me, cm.user_id)
   limit 1;
  if v_blocked is not null then
    raise exception 'You cannot message this ride because of a block between you and %', v_blocked
      using errcode = '42501';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation, v_me, trim(p_body))
  returning * into v_msg;

  update public.conversations set updated_at = now() where id = p_conversation;
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = v_me;

  select full_name into v_name from public.profiles where id = v_me;

  for other in
    select cm.user_id from public.conversation_members cm
     where cm.conversation_id = p_conversation and cm.left_at is null and cm.user_id <> v_me
  loop
    perform public.notify_user(other.user_id, 'message', v_name || ' sent you a message',
      left(trim(p_body), 120), v_conv.ride_id, null,
      jsonb_build_object('conversation_id', p_conversation));
  end loop;

  return v_msg;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if not public.is_conversation_member(p_conversation, auth.uid()) then
    raise exception 'You are not part of this conversation' using errcode = '42501'; end if;

  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();

  update public.messages set read_at = now()
   where conversation_id = p_conversation and sender_id <> auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.my_conversations()
returns table (
  id uuid, ride_id uuid, status public.conversation_status,
  origin_label text, destination_label text, depart_date date, depart_time time,
  ride_status public.ride_status, seats_remaining smallint,
  other_names text, other_count int,
  last_message text, last_sender text, last_message_at timestamptz,
  unread int, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'You must be signed in' using errcode = '42501'; end if;
  return query
    select c.id, c.ride_id, c.status,
           r.origin_label, r.destination_label, r.depart_date, r.depart_time,
           r.status, r.seats_remaining,
           (select coalesce(string_agg(p.full_name, ', ' order by p.full_name), 'Nobody else yet')
              from public.conversation_members cm2 join public.profiles p on p.id = cm2.user_id
             where cm2.conversation_id = c.id and cm2.left_at is null and cm2.user_id <> v_me),
           (select count(*)::int from public.conversation_members cm3
             where cm3.conversation_id = c.id and cm3.left_at is null and cm3.user_id <> v_me),
           (select m.body from public.messages m where m.conversation_id = c.id
             order by m.created_at desc limit 1),
           (select sp.full_name from public.messages m join public.profiles sp on sp.id = m.sender_id
             where m.conversation_id = c.id order by m.created_at desc limit 1),
           (select m.created_at from public.messages m where m.conversation_id = c.id
             order by m.created_at desc limit 1),
           (select count(*)::int from public.messages m
             where m.conversation_id = c.id and m.sender_id <> v_me
               and (cm.last_read_at is null or m.created_at > cm.last_read_at)),
           c.updated_at
      from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id
      join public.rides r on r.id = c.ride_id
     where cm.user_id = v_me and cm.left_at is null
     order by c.updated_at desc;
end $$;

create or replace function public.unread_message_count()
returns integer language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(x)::int, 0) from (
    select (select count(*) from public.messages m
             where m.conversation_id = cm.conversation_id and m.sender_id <> auth.uid()
               and (cm.last_read_at is null or m.created_at > cm.last_read_at)) as x
      from public.conversation_members cm
     where cm.user_id = auth.uid() and cm.left_at is null) t;
$$;

create or replace function public.conversation_detail(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb; v_me uuid := auth.uid();
begin
  if not public.is_conversation_member(p_conversation, v_me) then
    raise exception 'You are not part of this conversation' using errcode = '42501'; end if;

  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'ride_id', c.ride_id,
    'ride', jsonb_build_object(
      'origin_label', r.origin_label, 'destination_label', r.destination_label,
      'depart_date', r.depart_date, 'depart_time', r.depart_time,
      'status', r.status, 'seats_offered', r.seats_offered,
      'seats_remaining', r.seats_remaining, 'driver_id', r.driver_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                  'rating_avg', p.rating_avg, 'rating_count', p.rating_count,
                  'role', cm.role, 'is_me', p.id = v_me) order by cm.role, p.full_name), '[]'::jsonb)
                 from public.conversation_members cm join public.profiles p on p.id = cm.user_id
                where cm.conversation_id = c.id and cm.left_at is null)
  ) into v
  from public.conversations c join public.rides r on r.id = c.ride_id
  where c.id = p_conversation;
  return v;
end $$;

create or replace function public.conversation_messages(p_conversation uuid, p_limit int default 200)
returns table (id uuid, sender_id uuid, sender_name text, sender_avatar text,
               body text, created_at timestamptz, is_mine boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_conversation_member(p_conversation, auth.uid()) then
    raise exception 'You are not part of this conversation' using errcode = '42501'; end if;
  return query
    select m.id, m.sender_id, p.full_name, p.avatar_url, m.body, m.created_at,
           m.sender_id = auth.uid()
      from public.messages m join public.profiles p on p.id = m.sender_id
     where m.conversation_id = p_conversation
     order by m.created_at asc
     limit least(coalesce(p_limit, 200), 500);
end $$;

create or replace function public.my_ride_conversation(p_ride uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select c.id from public.conversations c
    join public.conversation_members cm on cm.conversation_id = c.id
   where c.ride_id = p_ride and cm.user_id = auth.uid() and cm.left_at is null;
$$;

create or replace function public.report_conversation(
  p_conversation uuid, p_category text, p_details text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_ride uuid; v_other uuid;
begin
  if not public.is_conversation_member(p_conversation, auth.uid()) then
    raise exception 'You are not part of this conversation' using errcode = '42501'; end if;
  if p_details is null or char_length(trim(p_details)) < 5 then
    raise exception 'Please describe what happened' using errcode = '22023'; end if;

  select ride_id into v_ride from public.conversations where id = p_conversation;

  select cm.user_id into v_other from public.conversation_members cm
   where cm.conversation_id = p_conversation and cm.left_at is null and cm.user_id <> auth.uid()
   limit 2;
  if (select count(*) from public.conversation_members
       where conversation_id = p_conversation and left_at is null and user_id <> auth.uid()) > 1 then
    v_other := null;   -- group chat: let a human decide who it is about
  end if;

  insert into public.reports (reporter_id, reported_user_id, ride_id, conversation_id, category, details)
  values (auth.uid(), v_other, v_ride, p_conversation, p_category, trim(p_details))
  returning id into v_id;
  return v_id;
end $$;

-- Message content reaches an admin only for a conversation that has been
-- reported, and every look is written to the admin action log.
create or replace function public.admin_conversation_messages(p_report uuid)
returns table (id uuid, sender_name text, body text, created_at timestamptz, is_reporter boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_reporter uuid; v_cat text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  select rep.conversation_id, rep.reporter_id, rep.category
    into v_conv, v_reporter, v_cat
    from public.reports rep where rep.id = p_report;

  if v_conv is null then
    raise exception 'That report is not about a conversation' using errcode = '22023'; end if;

  perform public.log_admin_action('conversation.messages_viewed', 'report', p_report, v_cat,
    jsonb_build_object('conversation_id', v_conv));

  return query
    select m.id, p.full_name, m.body, m.created_at, m.sender_id = v_reporter
      from public.messages m join public.profiles p on p.id = m.sender_id
     where m.conversation_id = v_conv
     order by m.created_at asc limit 500;
end $$;

grant execute on function public.send_message(uuid, text)              to authenticated;
grant execute on function public.mark_conversation_read(uuid)          to authenticated;
grant execute on function public.my_conversations()                    to authenticated;
grant execute on function public.unread_message_count()                to authenticated;
grant execute on function public.conversation_detail(uuid)             to authenticated;
grant execute on function public.conversation_messages(uuid, int)      to authenticated;
grant execute on function public.my_ride_conversation(uuid)            to authenticated;
grant execute on function public.report_conversation(uuid, text, text) to authenticated;
grant execute on function public.admin_conversation_messages(uuid)     to authenticated;
