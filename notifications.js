import { supabase } from './client.js';

export async function listNotifications(limit = 40) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('notifications')
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function unreadCount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count, error } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).is('read_at', null);
  if (error) return 0;
  return count || 0;
}

export async function markRead(ids) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids || null });
  if (error) throw error;
}

/**
 * Live delivery. The Expo app calls this same function — swap the callback for
 * a local push notification and the behaviour is identical.
 */
export function subscribe(userId, onInsert) {
  return supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
}
