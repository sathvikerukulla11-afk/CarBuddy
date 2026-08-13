import { supabase } from './client.js';

/** Called by the young rider — produces a code to hand to a parent/guardian. */
export async function createGuardianInvite() {
  const { data, error } = await supabase.rpc('create_guardian_invite');
  if (error) throw error;
  return data;
}

/** Called by the adult — links their account to the young rider's. */
export async function claimGuardianInvite(code, relationship) {
  const { data, error } = await supabase.rpc('claim_guardian_invite', {
    p_code: code, p_relationship: relationship || 'Parent/Guardian',
  });
  if (error) throw error;
  return data;
}

export async function revokeGuardianLink(relationshipId) {
  const { error } = await supabase.rpc('revoke_guardian_link', { p_relationship_id: relationshipId });
  if (error) throw error;
}

/** The young riders linked to me. */
export async function myDependents() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('guardian_relationships')
    .select('id, status, relationship, created_at, linked_at, minor:profiles!guardian_relationships_minor_id_fkey(id, full_name, avatar_url, age_category, rating_avg, rides_completed, verification_status)')
    .eq('guardian_id', user.id).eq('status', 'active');
  if (error) throw error;
  return data || [];
}

/** The guardians linked to me (from the young rider's side). */
export async function myGuardians() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('guardian_relationships')
    .select('id, status, relationship, invite_code, created_at, linked_at, guardian:profiles!guardian_relationships_guardian_id_fkey(id, full_name, avatar_url)')
    .eq('minor_id', user.id).in('status', ['pending', 'active']);
  if (error) throw error;
  return data || [];
}

const RIDE_FIELDS = 'id, origin_label, destination_label, depart_date, depart_time, depart_at, contribution_amount, status, seats_offered, seats_remaining, driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_avg, rating_count, rides_completed, verification_status)';

/** Every ride request from any young rider I am responsible for. */
export async function dependentRequests({ onlyPending = false } = {}) {
  const deps = await myDependents();
  const ids = deps.map((d) => d.minor?.id).filter(Boolean);
  if (!ids.length) return [];

  let q = supabase.from('ride_requests')
    .select(`id, ride_id, rider_id, seats_requested, message, status, guardian_status, guardian_note, guardian_decided_at, created_at,
             rider:profiles!ride_requests_rider_id_fkey(id, full_name, avatar_url),
             ride:rides(${RIDE_FIELDS})`)
    .in('rider_id', ids)
    .order('created_at', { ascending: false });
  if (onlyPending) q = q.eq('guardian_status', 'pending');

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function decideRequest(requestId, approve, note) {
  const { data, error } = await supabase.rpc('guardian_decide_request', {
    p_request_id: requestId, p_approve: approve, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

/** Meetup details for a ride a dependent is on (guardians may read these). */
export async function dependentRideMeetup(rideId) {
  const { data } = await supabase.from('ride_meetups').select('*').eq('ride_id', rideId).maybeSingle();
  return data;
}
