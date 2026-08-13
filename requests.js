import { supabase } from './client.js';

const RIDER   = 'rider:profiles!ride_requests_rider_id_fkey(id, full_name, avatar_url, rating_avg, rating_count, rides_completed, verification_status, is_minor, age_category)';
const RIDE    = 'ride:rides(id, origin_label, destination_label, depart_date, depart_time, depart_at, seats_offered, seats_taken, seats_remaining, contribution_amount, status, driver_id, driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_avg, rating_count, verification_status))';

export const REQUEST_COLUMNS = `
  id, ride_id, rider_id, seats_requested, message, status,
  guardian_status, guardian_id, guardian_note, guardian_decided_at,
  responded_at, created_at
`;

export async function requestToJoin(rideId, { message = '', seats = 1 } = {}) {
  const { data, error } = await supabase.rpc('request_to_join', {
    p_ride_id: rideId, p_message: message || null, p_seats: seats,
  });
  if (error) throw error;
  return data;
}

export async function respondToRequest(requestId, accept) {
  const { data, error } = await supabase.rpc('respond_to_request', {
    p_request_id: requestId, p_accept: accept,
  });
  if (error) throw error;
  return data;
}

export async function cancelRequest(requestId) {
  const { data, error } = await supabase.rpc('cancel_request', { p_request_id: requestId });
  if (error) throw error;
  return data;
}

/** My own request for a specific ride, if any. */
export async function myRequestForRide(rideId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('ride_requests').select(REQUEST_COLUMNS)
    .eq('ride_id', rideId).eq('rider_id', user.id)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

export async function requestsForRide(rideId, status) {
  let q = supabase.from('ride_requests').select(`${REQUEST_COLUMNS}, ${RIDER}`).eq('ride_id', rideId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Every pending request across all the rides I drive. */
export async function myIncomingRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: rides, error: e1 } = await supabase
    .from('rides').select('id').eq('driver_id', user.id).in('status', ['upcoming', 'active']);
  if (e1) throw e1;
  const ids = (rides || []).map((r) => r.id);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('ride_requests').select(`${REQUEST_COLUMNS}, ${RIDER}, ${RIDE}`)
    .in('ride_id', ids).eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Requests I have sent as a rider. */
export async function myOutgoingRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('ride_requests').select(`${REQUEST_COLUMNS}, ${RIDE}`)
    .eq('rider_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
