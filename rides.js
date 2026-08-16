import { supabase } from './client.js';
import { toInstant } from './format.js';

const DRIVER = 'driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_avg, rating_count, rides_completed, verification_status, is_minor)';
const GROUP  = 'group:trusted_groups(id, name, group_type)';

export const RIDE_COLUMNS = `
  id, driver_id, origin_label, origin_area, destination_label, destination_area,
  origin_lat, origin_lng, destination_lat, destination_lng,
  depart_date, depart_time, depart_at, seats_offered, seats_taken, seats_remaining,
  contribution_amount, notes, visibility, group_id, is_listed, status,
  cancelled_reason, created_at, ${DRIVER}, ${GROUP}
`;

/**
 * The Find a Ride query. Runs entirely in Postgres via search_rides_nearby so
 * the mile radius is measured server-side and Row Level Security still decides
 * which rides come back.
 *
 * Called with no filters it returns every current listed ride, which is what
 * the page shows before you type anything.
 *
 * Rows come back flat; reshape them to match the nested shape rideCard expects.
 */
export async function searchRidesNearby({
  lat, lng, radiusMiles, origin, destination, date,
  timeFrom, timeTo, minSeats, maxContribution, includeFull = true, limit = 100,
} = {}) {
  const { data, error } = await supabase.rpc('search_rides_nearby', {
    p_lat: lat ?? null,
    p_lng: lng ?? null,
    p_radius_miles: (lat != null && lng != null && radiusMiles) ? Number(radiusMiles) : null,
    p_origin: origin?.trim() || null,
    p_destination: destination?.trim() || null,
    p_date: date || null,
    p_time_from: timeFrom || null,
    p_time_to: timeTo || null,
    p_min_seats: minSeats ? Number(minSeats) : null,
    p_max_contribution: (maxContribution === '' || maxContribution == null)
      ? null : Number(maxContribution),
    p_include_full: includeFull,
    p_limit: limit,
  });
  if (error) throw error;

  return (data || []).map((r) => ({
    ...r,
    driver: {
      id: r.driver_id,
      full_name: r.driver_name,
      avatar_url: r.driver_avatar,
      rating_avg: r.driver_rating,
      rating_count: r.driver_rating_count,
      rides_completed: r.driver_rides_completed,
      verification_status: r.driver_verification,
    },
    group: r.group_id ? { id: r.group_id, name: r.group_name } : null,
  }));
}

/**
 * Search listed, upcoming rides.
 * Row Level Security decides what is visible — this only narrows the result.
 */
export async function searchRides({
  origin, destination, date, timeFrom, timeTo,
  minSeats, maxContribution, groupId, includeFull = true, limit = 60,
} = {}) {
  let q = supabase.from('rides').select(RIDE_COLUMNS)
    .eq('status', 'upcoming')
    .eq('is_listed', true)
    .gte('depart_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('depart_at', { ascending: true })
    .limit(limit);

  if (origin)       q = q.ilike('origin_label', `%${origin.trim()}%`);
  if (destination)  q = q.ilike('destination_label', `%${destination.trim()}%`);
  if (date)         q = q.eq('depart_date', date);
  if (timeFrom)     q = q.gte('depart_time', timeFrom);
  if (timeTo)       q = q.lte('depart_time', timeTo);
  if (minSeats)     q = q.gte('seats_remaining', Number(minSeats));
  if (maxContribution !== '' && maxContribution != null) {
    q = q.lte('contribution_amount', Number(maxContribution));
  }
  if (groupId)      q = q.eq('group_id', groupId);
  if (!includeFull) q = q.gt('seats_remaining', 0);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getRide(rideId) {
  const { data, error } = await supabase
    .from('rides').select(RIDE_COLUMNS).eq('id', rideId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createRide(form) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const payload = {
    driver_id: user.id,
    origin_label: form.origin.trim(),
    origin_area: form.originArea?.trim() || null,
    destination_label: form.destination.trim(),
    destination_area: form.destinationArea?.trim() || null,
    origin_lat: form.originLat ?? null,
    origin_lng: form.originLng ?? null,
    destination_lat: form.destinationLat ?? null,
    destination_lng: form.destinationLng ?? null,
    geocoded_at: (form.originLat != null || form.destinationLat != null) ? new Date().toISOString() : null,
    depart_date: form.date,
    depart_time: form.time,
    depart_at: toInstant(form.date, form.time),
    seats_offered: Number(form.seats),
    contribution_amount: Number(form.contribution || 0),
    notes: form.notes?.trim() || null,
    visibility: form.visibility,
    group_id: form.visibility === 'group' ? form.groupId : null,
  };

  const { data, error } = await supabase.from('rides').insert(payload).select('id').single();
  if (error) throw error;

  if (form.meetupPlace || form.meetupNotes) {
    await setRideMeetup(data.id, {
      meetup_place: form.meetupPlace?.trim() || null,
      meetup_notes: form.meetupNotes?.trim() || null,
    });
  }
  return data.id;
}

export async function updateRide(rideId, patch) {
  const { data, error } = await supabase
    .from('rides').update(patch).eq('id', rideId).select(RIDE_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function cancelRide(rideId, reason) {
  const { data, error } = await supabase.rpc('cancel_ride', { p_ride_id: rideId, p_reason: reason || null });
  if (error) throw error;
  return data;
}

export async function completeRide(rideId) {
  const { data, error } = await supabase.rpc('complete_ride', { p_ride_id: rideId });
  if (error) throw error;
  return data;
}

export async function deleteRide(rideId) {
  const { error } = await supabase.from('rides').delete().eq('id', rideId);
  if (error) throw error;
}

/** Rides where I am the driver. */
export async function myDrivingRides() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('rides').select(RIDE_COLUMNS)
    .eq('driver_id', user.id)
    .order('depart_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Rides I have joined (accepted seat). */
export async function myJoinedRides() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('ride_participants')
    .select(`id, seats, status, joined_at, ride:rides(${RIDE_COLUMNS})`)
    .eq('user_id', user.id)
    .eq('status', 'joined');
  if (error) throw error;
  return (data || []).filter((r) => r.ride)
    .sort((a, b) => new Date(b.ride.depart_at) - new Date(a.ride.depart_at));
}

export async function getParticipants(rideId) {
  const { data, error } = await supabase
    .from('ride_participants')
    .select('id, user_id, seats, status, joined_at, profile:profiles!ride_participants_user_id_fkey(id, full_name, avatar_url, rating_avg, rating_count, verification_status, is_minor)')
    .eq('ride_id', rideId)
    .eq('status', 'joined');
  if (error) throw error;
  return data || [];
}

export async function getRideMeetup(rideId) {
  const { data, error } = await supabase
    .from('ride_meetups').select('*').eq('ride_id', rideId).maybeSingle();
  if (error && error.code !== 'PGRST116') return null;
  return data;
}

export async function setRideMeetup(rideId, fields) {
  const { data, error } = await supabase
    .from('ride_meetups').upsert({ ride_id: rideId, ...fields }).select().single();
  if (error) throw error;
  return data;
}

/** Phone numbers, released by the server only to confirmed participants. */
export async function getRideContacts(rideId) {
  const { data, error } = await supabase.rpc('get_ride_contacts', { p_ride_id: rideId });
  if (error) throw error;
  return data || [];
}

export async function removeParticipant(rideId, userId) {
  const { error } = await supabase.rpc('remove_participant', { p_ride_id: rideId, p_user_id: userId });
  if (error) throw error;
}


/**
 * What sharing rides has actually added up to, for the signed-in member.
 * Everything is derived from completed rides; distance-based figures only count
 * rides that were geocoded, and the caller is told how many that was so it can
 * caveat the estimate honestly.
 */
export async function myImpact() {
  const { data, error } = await supabase.rpc('my_impact');
  if (error) throw error;
  return data;
}

/** Public-safe community totals for the landing page. */
export async function communityStats() {
  const { data, error } = await supabase.rpc('community_stats');
  if (error) throw error;
  return data;
}
