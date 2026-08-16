-- ============================================================================
-- 0020  A report must not stop you deleting the thing it was about
-- ============================================================================
-- report_has_target was a CHECK, so it applied to UPDATEs too. A cascade that
-- nulled ride_id / conversation_id aborted the whole delete, meaning a safety
-- record could block ride or account deletion. Enforce it on INSERT only, and
-- keep a text snapshot so an orphaned report still reads sensibly.

alter table public.reports drop constraint if exists report_has_target;
alter table public.reports add column if not exists target_snapshot text;

create or replace function public.guard_report_insert()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.reported_user_id is null and new.ride_id is null and new.conversation_id is null then
    raise exception 'A report must name a member, a ride or a conversation' using errcode = '23514';
  end if;

  if new.target_snapshot is null then
    new.target_snapshot := coalesce(
      (select 'member: ' || p.full_name from public.profiles p where p.id = new.reported_user_id),
      (select 'ride: ' || r.origin_label || ' to ' || r.destination_label
         from public.rides r where r.id = new.ride_id),
      case when new.conversation_id is not null then 'ride conversation' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_report_insert on public.reports;
create trigger trg_guard_report_insert
  before insert on public.reports
  for each row execute function public.guard_report_insert();

update public.reports r
   set target_snapshot = coalesce(
     (select 'member: ' || p.full_name from public.profiles p where p.id = r.reported_user_id),
     (select 'ride: ' || rd.origin_label || ' to ' || rd.destination_label
        from public.rides rd where rd.id = r.ride_id),
     case when r.conversation_id is not null then 'ride conversation' end,
     'unknown')
 where r.target_snapshot is null;
