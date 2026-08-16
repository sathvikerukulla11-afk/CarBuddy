/**
 * Admin data layer.
 *
 * Every call goes through a SECURITY DEFINER function that re-checks
 * `is_admin()` inside Postgres, so a non-admin who somehow reaches this code
 * gets "Administrators only" from the database rather than a blank page.
 * Nothing here trusts a client-side flag.
 *
 * No DOM access, so the future Expo admin app can import it unchanged.
 */
import { supabase } from './client.js';

const rpc = async (name, args = {}) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

/* ------------------------------------------------------------- overview -- */
export const overview       = () => rpc('admin_overview');
export const recentActivity = (limit = 25) => rpc('admin_recent_activity', { p_limit: limit });

/* ---------------------------------------------------------------- users -- */
export const listUsers  = (search = '', limit = 200) =>
  rpc('admin_list_users', { p_search: search || null, p_limit: limit });
export const userDetail  = (id) => rpc('admin_user_detail',  { p_user: id });
export const userRides   = (id) => rpc('admin_user_rides',   { p_user: id });
export const userReports = (id) => rpc('admin_user_reports', { p_user: id });

/* ---------------------------------------------------------------- rides -- */
export const listRides = (status = null, search = '', limit = 200) =>
  rpc('admin_rides', { p_status: status || null, p_search: search || null, p_limit: limit });
export const rideDetail = (id) => rpc('admin_ride_detail', { p_ride: id });

/* -------------------------------------------------------------- reports -- */
export const listReports  = (status = null) => rpc('admin_reports', { p_status: status || null });
export const reportDetail = (id) => rpc('admin_report_detail', { p_report: id });

/* --------------------------------------------------------- verification -- */
export const verificationQueue = (status = 'pending') =>
  rpc('admin_verification_queue', { p_status: status });

/* ------------------------------------------------- analytics + audit log -- */
export const analytics = (days = 30) => rpc('admin_analytics', { p_days: days });
export const actionLog = (limit = 100) => rpc('admin_action_log', { p_limit: limit });

/** Message content for a reported conversation. Every call is logged. */
export const conversationMessages = (reportId) =>
  rpc('admin_conversation_messages', { p_report: reportId });

/* ---------------------------------------------------------------- write -- */
/* Each of these writes an entry to admin_actions inside the same transaction. */
export const setVerification = (userId, status) =>
  rpc('admin_set_verification', { p_user: userId, p_status: status });

export const suspendUser = (userId, suspend, reason) =>
  rpc('admin_suspend_user', { p_user: userId, p_suspend: suspend, p_reason: reason || null });

export const cancelRide = (rideId, reason) =>
  rpc('admin_remove_ride', { p_ride: rideId, p_reason: reason || null });

export const resolveReport = (reportId, status, notes) =>
  rpc('admin_resolve_report', { p_report: reportId, p_status: status, p_notes: notes || null });

export const setAdmin = (userId, isAdmin) =>
  rpc('admin_set_admin', { p_user: userId, p_is_admin: isAdmin });

export const runRideLifecycle = () => rpc('admin_close_departed_rides');

/* Kept for compatibility with the previous admin page. */
export const stats = overview;
export const removeRide = cancelRide;
