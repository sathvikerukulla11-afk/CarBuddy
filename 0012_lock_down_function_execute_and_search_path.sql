-- ============================================================================
-- 0012  Two findings from the Supabase database linter, both real.
-- ============================================================================
-- 1. Postgres grants EXECUTE on new functions to PUBLIC by default, so every
--    SECURITY DEFINER helper was reachable at /rest/v1/rpc/... by the `anon`
--    role. Most would fail internally (auth.uid() is null), but the relationship
--    helpers bypass RLS by design and would answer questions about specific
--    UUIDs to a signed-out caller.
-- 2. Twelve functions had a mutable search_path (pinned here and in 0009-0011).

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- ---- helpers referenced inside RLS policies --------------------------------
-- Policies are evaluated with the querying role's privileges, so `authenticated`
-- must keep EXECUTE on every function a policy calls.
grant execute on function public.is_admin(uuid)                     to authenticated;
grant execute on function public.is_suspended(uuid)                 to authenticated;
grant execute on function public.is_verified(uuid)                  to authenticated;
grant execute on function public.is_guardian_of(uuid, uuid)         to authenticated;
grant execute on function public.is_group_member(uuid, uuid)        to authenticated;
grant execute on function public.is_group_admin(uuid, uuid)         to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid)     to authenticated;
grant execute on function public.is_ride_driver(uuid, uuid)         to authenticated;
grant execute on function public.is_ride_participant(uuid, uuid)    to authenticated;
grant execute on function public.has_request_on_ride(uuid, uuid)    to authenticated;
grant execute on function public.has_active_guardian(uuid)          to authenticated;
grant execute on function public.guards_someone_on_ride(uuid, uuid) to authenticated;
grant execute on function public.can_participate(uuid)              to authenticated;
grant execute on function public.is_privileged()                    to authenticated;
grant execute on function public.is_client_role()                   to authenticated;

-- ---- the actual client API -------------------------------------------------
grant execute on function public.request_to_join(uuid, text, smallint)        to authenticated;
grant execute on function public.respond_to_request(uuid, boolean)            to authenticated;
grant execute on function public.cancel_request(uuid)                         to authenticated;
grant execute on function public.remove_participant(uuid, uuid)               to authenticated;
grant execute on function public.cancel_ride(uuid, text)                      to authenticated;
grant execute on function public.complete_ride(uuid)                          to authenticated;
grant execute on function public.get_ride_contacts(uuid)                      to authenticated;
grant execute on function public.create_guardian_invite()                     to authenticated;
grant execute on function public.claim_guardian_invite(text, text)            to authenticated;
grant execute on function public.revoke_guardian_link(uuid)                   to authenticated;
grant execute on function public.guardian_decide_request(uuid, boolean, text) to authenticated;
grant execute on function public.rate_user(uuid, uuid, smallint, text)        to authenticated;
grant execute on function public.join_group_by_code(text)                     to authenticated;
grant execute on function public.set_group_member_status(uuid, uuid, public.member_status) to authenticated;
grant execute on function public.mark_notifications_read(uuid[])              to authenticated;
grant execute on function public.request_verification()                       to authenticated;
grant execute on function public.recount_ride_seats(uuid)                     to authenticated;
grant execute on function public.miles_between(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.search_rides_nearby(
  double precision, double precision, double precision, text, text, date, time, time,
  int, numeric, boolean, int) to authenticated;

-- ---- admin surface (each one re-checks is_admin() internally) --------------
grant execute on function public.admin_set_verification(uuid, public.verification_status) to authenticated;
grant execute on function public.admin_suspend_user(uuid, boolean, text)                  to authenticated;
grant execute on function public.admin_remove_ride(uuid, text)                            to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status, text)   to authenticated;
grant execute on function public.admin_stats()                                            to authenticated;
grant execute on function public.admin_list_users(text, int)                              to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean)                           to authenticated;

-- Trigger functions and bootstrap_admin are deliberately NOT granted: triggers
-- fire regardless of the invoker's EXECUTE privilege, so nothing needs them to
-- be reachable over REST.

-- ---- pin the search_path on the remaining functions ------------------------
alter function public.touch_updated_at()         set search_path = public, pg_temp;
alter function public.random_code(int)           set search_path = public, pg_temp;
alter function public.is_privileged()            set search_path = public, pg_temp;
alter function public.guard_profile_columns()    set search_path = public, pg_temp;
alter function public.guard_ride_columns()       set search_path = public, pg_temp;
alter function public.guard_request_writes()     set search_path = public, pg_temp;
alter function public.guard_participant_writes() set search_path = public, pg_temp;
alter function public.guard_rating_writes()      set search_path = public, pg_temp;
alter function public.guard_report_updates()     set search_path = public, pg_temp;
