import { supabase } from './client.js';

export async function myGroups() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('group_members')
    .select('role, status, joined_at, group:trusted_groups(id, name, description, area, group_type, join_code, is_open, member_count, created_by)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter((r) => r.group);
}

export async function myActiveGroups() {
  return (await myGroups()).filter((r) => r.status === 'active');
}

export async function browseGroups(search = '') {
  let q = supabase.from('trusted_groups')
    .select('id, name, description, area, group_type, is_open, member_count, created_by')
    .order('member_count', { ascending: false }).limit(40);
  if (search.trim()) q = q.or(`name.ilike.%${search.trim()}%,area.ilike.%${search.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createGroup({ name, description, area, groupType, isOpen }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase.from('trusted_groups').insert({
    name: name.trim(),
    description: description?.trim() || null,
    area: area?.trim() || null,
    group_type: groupType || 'other',
    is_open: !!isOpen,
    created_by: user.id,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function joinGroupByCode(code) {
  const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code });
  if (error) throw error;
  return data;
}

export async function groupMembers(groupId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, role, status, joined_at, profile:profiles!group_members_user_id_fkey(id, full_name, avatar_url, verification_status, rating_avg, is_minor)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setMemberStatus(groupId, userId, status) {
  const { error } = await supabase.rpc('set_group_member_status', {
    p_group: groupId, p_user: userId, p_status: status,
  });
  if (error) throw error;
}

export async function leaveGroup(groupId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('group_members')
    .delete().eq('group_id', groupId).eq('user_id', user.id);
  if (error) throw error;
}
