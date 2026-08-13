import { supabase } from './client.js';

export async function stats() {
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data;
}

export async function listUsers(search = '', limit = 100) {
  const { data, error } = await supabase.rpc('admin_list_users', { p_search: search || null, p_limit: limit });
  if (error) throw error;
  return data || [];
}

export async function listRides(status = null, limit = 100) {
  let q = supabase.from('rides')
    .select('id, origin_label, destination_label, depart_date, depart_time, seats_offered, seats_taken, seats_remaining, contribution_amount, visibility, status, created_at, driver:profiles!rides_driver_id_fkey(id, full_name, is_suspended)')
    .order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listReports(status = null) {
  let q = supabase.from('reports')
    .select('id, category, details, status, admin_notes, created_at, resolved_at, ride_id, reporter:profiles!reports_reporter_id_fkey(id, full_name), reported:profiles!reports_reported_user_id_fkey(id, full_name, is_suspended)')
    .order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function setVerification(userId, status) {
  const { error } = await supabase.rpc('admin_set_verification', { p_user: userId, p_status: status });
  if (error) throw error;
}

export async function suspendUser(userId, suspend, reason) {
  const { error } = await supabase.rpc('admin_suspend_user', {
    p_user: userId, p_suspend: suspend, p_reason: reason || null,
  });
  if (error) throw error;
}

export async function removeRide(rideId, reason) {
  const { error } = await supabase.rpc('admin_remove_ride', { p_ride: rideId, p_reason: reason || null });
  if (error) throw error;
}

export async function resolveReport(reportId, status, notes) {
  const { error } = await supabase.rpc('admin_resolve_report', {
    p_report: reportId, p_status: status, p_notes: notes || null,
  });
  if (error) throw error;
}

export async function setAdmin(userId, isAdmin) {
  const { error } = await supabase.rpc('admin_set_admin', { p_user: userId, p_is_admin: isAdmin });
  if (error) throw error;
}
