-- ============================================================================
-- 0008  Avatar storage bucket + admin bootstrap helper
-- ============================================================================

-- Public bucket for profile photos. Files are namespaced by user id so a member
-- can only write inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = 3145728,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "members upload their own avatar" on storage.objects;
create policy "members upload their own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members replace their own avatar" on storage.objects;
create policy "members replace their own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members delete their own avatar" on storage.objects;
create policy "members delete their own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Promote the first administrator. Run this ONCE, from the Supabase SQL editor,
-- after signing up with the account that should own the admin console:
--
--   select public.bootstrap_admin('you@example.com');
--
-- It refuses to run once any admin exists, so it cannot be abused later.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_admin(p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if exists (select 1 from public.profiles where is_admin) then
    raise exception 'An administrator already exists. Promote further admins from the admin dashboard.';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'No account found for %. Sign up first, then run this again.', p_email;
  end if;
  perform public.begin_privileged();
  update public.profiles set is_admin = true, verification_status = 'verified' where id = v_id;
  return 'Admin enabled for ' || p_email;
end $$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;

-- Existing admins can promote or demote other members from the dashboard.
create or replace function public.admin_set_admin(p_user uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_user = auth.uid() and not p_is_admin then
    raise exception 'You cannot remove your own admin access' using errcode = '22023'; end if;
  perform public.begin_privileged();
  update public.profiles set is_admin = p_is_admin where id = p_user;
end $$;

grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- Members ask for verification; an admin approves it in the dashboard.
create or replace function public.request_verification()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.begin_privileged();
  update public.profiles set verification_status = 'pending'
   where id = auth.uid() and verification_status in ('unverified', 'rejected');
end $$;

grant execute on function public.request_verification() to authenticated;
