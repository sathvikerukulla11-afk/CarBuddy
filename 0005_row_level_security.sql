-- ============================================================================
-- 0005  Row Level Security
--       Nothing in this app relies on the frontend hiding a button. Every rule
--       below is enforced by Postgres for every client, web or mobile.
-- ============================================================================

alter table public.profiles              enable row level security;
alter table public.profiles_private      enable row level security;
alter table public.trusted_groups        enable row level security;
alter table public.group_members         enable row level security;
alter table public.blocked_users         enable row level security;
alter table public.guardian_relationships enable row level security;
alter table public.rides                 enable row level security;
alter table public.ride_meetups          enable row level security;
alter table public.ride_requests         enable row level security;
alter table public.ride_participants     enable row level security;
alter table public.ratings               enable row level security;
alter table public.reports               enable row level security;
alter table public.notifications         enable row level security;

-- ------------------------------------------------------------- profiles ---
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);   -- only public-safe columns live in this table

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- ----------------------------------------------------- profiles_private ---
drop policy if exists profiles_private_select on public.profiles_private;
create policy profiles_private_select on public.profiles_private
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_guardian_of(id)
    or public.is_admin()
  );

drop policy if exists profiles_private_insert on public.profiles_private;
create policy profiles_private_insert on public.profiles_private
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_private_update on public.profiles_private;
create policy profiles_private_update on public.profiles_private
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- -------------------------------------------------------- trusted groups ---
drop policy if exists groups_select on public.trusted_groups;
create policy groups_select on public.trusted_groups
  for select to authenticated
  using (true);

drop policy if exists groups_insert on public.trusted_groups;
create policy groups_insert on public.trusted_groups
  for insert to authenticated
  with check (created_by = (select auth.uid()) and public.can_participate());

drop policy if exists groups_update on public.trusted_groups;
create policy groups_update on public.trusted_groups
  for update to authenticated
  using (public.is_group_admin(id) or public.is_admin())
  with check (public.is_group_admin(id) or public.is_admin());

drop policy if exists groups_delete on public.trusted_groups;
create policy groups_delete on public.trusted_groups
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

-- --------------------------------------------------------- group members ---
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_group_member(group_id)
    or public.is_group_admin(group_id)
    or public.is_admin()
  );

drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and status = 'pending')
    or public.is_group_admin(group_id)
  );

drop policy if exists group_members_update on public.group_members;
create policy group_members_update on public.group_members
  for update to authenticated
  using (public.is_group_admin(group_id) or public.is_admin())
  with check (public.is_group_admin(group_id) or public.is_admin());

drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_group_admin(group_id) or public.is_admin());

-- -------------------------------------------------------------- blocking ---
drop policy if exists blocks_select on public.blocked_users;
create policy blocks_select on public.blocked_users
  for select to authenticated
  using (blocker_id = (select auth.uid()) or public.is_admin());

drop policy if exists blocks_insert on public.blocked_users;
create policy blocks_insert on public.blocked_users
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy if exists blocks_delete on public.blocked_users;
create policy blocks_delete on public.blocked_users
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ------------------------------------------------ guardian relationships ---
drop policy if exists guardian_select on public.guardian_relationships;
create policy guardian_select on public.guardian_relationships
  for select to authenticated
  using (
    guardian_id = (select auth.uid())
    or minor_id = (select auth.uid())
    or public.is_admin()
  );

-- A minor may open an invite, but may never activate or revoke a link.
drop policy if exists guardian_insert on public.guardian_relationships;
create policy guardian_insert on public.guardian_relationships
  for insert to authenticated
  with check (
    minor_id = (select auth.uid())
    and guardian_id is null
    and status = 'pending'
  );

drop policy if exists guardian_update on public.guardian_relationships;
create policy guardian_update on public.guardian_relationships
  for update to authenticated
  using (guardian_id = (select auth.uid()) or public.is_admin())
  with check (guardian_id = (select auth.uid()) or public.is_admin());

drop policy if exists guardian_delete on public.guardian_relationships;
create policy guardian_delete on public.guardian_relationships
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------- rides ---
drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides
  for select to authenticated
  using (
    driver_id = (select auth.uid())
    or public.is_admin()
    or public.guards_someone_on_ride(id)
    -- people already involved keep access even once a ride is cancelled
    or public.is_ride_participant(id)
    or public.has_request_on_ride(id)
    or (
      status <> 'cancelled'
      and not public.is_suspended(driver_id)
      and not public.is_blocked_between((select auth.uid()), driver_id)
      and (
        visibility in ('verified', 'approval')
        or (visibility = 'group' and public.is_group_member(group_id))
      )
    )
  );

drop policy if exists rides_insert on public.rides;
create policy rides_insert on public.rides
  for insert to authenticated
  with check (driver_id = (select auth.uid()));

drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides
  for update to authenticated
  using (driver_id = (select auth.uid()) or public.is_admin())
  with check (driver_id = (select auth.uid()) or public.is_admin());

-- A ride with riders on board can only be cancelled, never deleted.
drop policy if exists rides_delete on public.rides;
create policy rides_delete on public.rides
  for delete to authenticated
  using ((driver_id = (select auth.uid()) and seats_taken = 0) or public.is_admin());

-- --------------------------------------------------------- ride meetups ---
drop policy if exists meetups_select on public.ride_meetups;
create policy meetups_select on public.ride_meetups
  for select to authenticated
  using (
    public.is_ride_driver(ride_id)
    or public.is_ride_participant(ride_id)
    or public.guards_someone_on_ride(ride_id)
    or public.is_admin()
  );

drop policy if exists meetups_write on public.ride_meetups;
create policy meetups_write on public.ride_meetups
  for all to authenticated
  using (public.is_ride_driver(ride_id) or public.is_admin())
  with check (public.is_ride_driver(ride_id) or public.is_admin());

-- --------------------------------------------------------- ride requests ---
-- Read-only for clients. Every write goes through an RPC in 0006 so the seat
-- count and the request status can never drift apart.
drop policy if exists requests_select on public.ride_requests;
create policy requests_select on public.ride_requests
  for select to authenticated
  using (
    rider_id = (select auth.uid())
    or public.is_ride_driver(ride_id)
    or public.is_guardian_of(rider_id)
    or public.is_admin()
  );

-- ----------------------------------------------------- ride participants ---
drop policy if exists participants_select on public.ride_participants;
create policy participants_select on public.ride_participants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_ride_driver(ride_id)
    or public.is_ride_participant(ride_id)
    or public.is_guardian_of(user_id)
    or public.is_admin()
  );

-- --------------------------------------------------------------- ratings ---
drop policy if exists ratings_select on public.ratings;
create policy ratings_select on public.ratings
  for select to authenticated
  using (true);

-- --------------------------------------------------------------- reports ---
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --------------------------------------------------------- notifications ---
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- grants ---
grant usage on schema public to anon, authenticated;

grant select                         on public.profiles              to authenticated;
grant insert, update                 on public.profiles              to authenticated;
grant select, insert, update         on public.profiles_private      to authenticated;
grant select, insert, update, delete on public.trusted_groups        to authenticated;
grant select, insert, update, delete on public.group_members         to authenticated;
grant select, insert, delete         on public.blocked_users         to authenticated;
grant select, insert, update         on public.guardian_relationships to authenticated;
grant select, insert, update, delete on public.rides                 to authenticated;
grant select, insert, update, delete on public.ride_meetups          to authenticated;
grant select                         on public.ride_requests         to authenticated;
grant select                         on public.ride_participants     to authenticated;
grant select                         on public.ratings               to authenticated;
grant select, insert, update         on public.reports               to authenticated;
grant select, update                 on public.notifications         to authenticated;
