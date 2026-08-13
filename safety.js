import { supabase } from './client.js';

export async function submitReport({ reportedUserId, rideId, category, details }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase.from('reports').insert({
    reporter_id: user.id,
    reported_user_id: reportedUserId || null,
    ride_id: rideId || null,
    category,
    details: details.trim(),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function myReports() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('reports')
    .select('id, category, details, status, created_at, ride_id, reported_user_id')
    .eq('reporter_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function blockUser(userId, reason) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('blocked_users')
    .insert({ blocker_id: user.id, blocked_id: userId, reason: reason || null });
  if (error && error.code !== '23505') throw error;
}

export async function unblockUser(userId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('blocked_users')
    .delete().eq('blocker_id', user.id).eq('blocked_id', userId);
  if (error) throw error;
}

export async function myBlockList() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('blocked_users')
    .select('blocked_id, reason, created_at, profile:profiles!blocked_users_blocked_id_fkey(id, full_name, avatar_url)')
    .eq('blocker_id', user.id);
  if (error) throw error;
  return data || [];
}

export async function rateUser(rideId, rateeId, stars, comment) {
  const { data, error } = await supabase.rpc('rate_user', {
    p_ride_id: rideId, p_ratee_id: rateeId, p_stars: stars, p_comment: comment || null,
  });
  if (error) throw error;
  return data;
}

export async function myRatingsGiven(rideId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('ratings')
    .select('id, ratee_id, stars').eq('rater_id', user.id).eq('ride_id', rideId);
  if (error) throw error;
  return data || [];
}
