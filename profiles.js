import { supabase } from './client.js';

export const PUBLIC_PROFILE_COLUMNS =
  'id, full_name, avatar_url, bio, home_area, age_category, is_minor, ' +
  'verification_status, is_admin, is_suspended, rating_avg, rating_count, ' +
  'rides_completed, onboarded, home_lat, home_lng, created_at';

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyPrivateProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles_private').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Only public-safe fields are accepted here; the database rejects the rest. */
export async function updateMyProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const allowed = ['full_name', 'avatar_url', 'bio', 'home_area', 'age_category',
                   'onboarded', 'home_lat', 'home_lng'];
  const patch = {};
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  const { data, error } = await supabase
    .from('profiles').update(patch).eq('id', user.id).select(PUBLIC_PROFILE_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateMyPrivateProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const allowed = ['phone', 'email', 'date_of_birth', 'emergency_contact_name', 'emergency_contact_phone'];
  const patch = { id: user.id };
  for (const k of allowed) if (k in fields) patch[k] = fields[k] || null;
  const { data, error } = await supabase
    .from('profiles_private').upsert(patch).select().single();
  if (error) throw error;
  return data;
}

export async function uploadAvatar(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  await updateMyProfile({ avatar_url: data.publicUrl });
  return data.publicUrl;
}

export async function requestVerification() {
  const { error } = await supabase.rpc('request_verification');
  if (error) throw error;
}

export async function getRatingsFor(userId, limit = 20) {
  const { data, error } = await supabase
    .from('ratings')
    .select('id, stars, comment, created_at, ride_id, rater:profiles!ratings_rater_id_fkey(id, full_name, avatar_url)')
    .eq('ratee_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
