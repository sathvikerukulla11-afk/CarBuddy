-- ============================================================================
-- 0010  The write guards blocked ON DELETE CASCADE, so deleting an account
--       failed. Found by trying to delete a test user.
-- ============================================================================
-- `authenticated` is granted SELECT only on these tables, so the DELETE arm of
-- each guard was never load-bearing. Guarding INSERT and UPDATE keeps every
-- protection that mattered while letting foreign-key cascades through.

drop trigger if exists trg_guard_requests on public.ride_requests;
create trigger trg_guard_requests before insert or update on public.ride_requests
  for each row execute function public.guard_request_writes();

drop trigger if exists trg_guard_participants on public.ride_participants;
create trigger trg_guard_participants before insert or update on public.ride_participants
  for each row execute function public.guard_participant_writes();

drop trigger if exists trg_guard_ratings on public.ratings;
create trigger trg_guard_ratings before insert or update on public.ratings
  for each row execute function public.guard_rating_writes();

drop trigger if exists trg_guard_reports on public.reports;
create trigger trg_guard_reports before update on public.reports
  for each row execute function public.guard_report_updates();

-- The rating rollup must survive the ratee disappearing mid-cascade.
create or replace function public.sync_profile_rating()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid := coalesce(new.ratee_id, old.ratee_id);
begin
  perform public.begin_privileged();
  update public.profiles p
     set rating_avg   = coalesce((select round(avg(stars)::numeric, 2)
                                    from public.ratings where ratee_id = v_user), 0),
         rating_count = (select count(*) from public.ratings where ratee_id = v_user)
   where p.id = v_user;
  return null;
exception when others then
  return null;   -- profile already gone in a cascade; nothing to roll up
end $$;
