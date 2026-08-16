/**
 * Messaging data layer.
 *
 * Conversations are ride-scoped and membership is granted by the server when a
 * driver accepts a rider — there is no "start a chat with anyone" call here,
 * deliberately. Every function below is refused by Postgres for a non-member.
 *
 * No DOM access, so the Expo app can import this unchanged.
 */
import { supabase } from './client.js';

const rpc = async (name, args = {}) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

/** Conversations I belong to, newest activity first, with unread counts. */
export const myConversations = () => rpc('my_conversations');

/** Total unread across every conversation — drives the nav badge. */
export const unreadMessageCount = () => rpc('unread_message_count');

/** Ride context + participants for the chat header. */
export const conversationDetail = (id) => rpc('conversation_detail', { p_conversation: id });

export const conversationMessages = (id, limit = 200) =>
  rpc('conversation_messages', { p_conversation: id, p_limit: limit });

/** The conversation for a ride, or null if I'm not in it. */
export const myRideConversation = (rideId) => rpc('my_ride_conversation', { p_ride: rideId });

/** Empty bodies, non-members and blocked pairs are all refused server-side. */
export const sendMessage = (conversationId, body) =>
  rpc('send_message', { p_conversation: conversationId, p_body: body });

export const markConversationRead = (id) => rpc('mark_conversation_read', { p_conversation: id });

export const reportConversation = (id, category, details) =>
  rpc('report_conversation', { p_conversation: id, p_category: category, p_details: details });

/**
 * Live messages for one conversation.
 *
 * Realtime respects Row Level Security, so a client that subscribes to a
 * conversation it does not belong to simply receives nothing.
 *
 * Returns the channel — call `supabase.removeChannel(ch)` when leaving.
 */
export function subscribeToConversation(conversationId, onMessage, onStatus) {
  return supabase
    .channel(`messages:${conversationId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new))
    .subscribe((status) => onStatus?.(status));
}

/** Live notification of any new message, used to keep the nav badge honest. */
export function subscribeToAllMessages(userId, onMessage) {
  return supabase
    .channel(`messages:all:${userId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => { if (payload.new.sender_id !== userId) onMessage(payload.new); })
    .subscribe();
}

export const REPORT_CONVERSATION_REASONS = [
  { value: 'harassment',              label: 'Harassment' },
  { value: 'inappropriate_behaviour', label: 'Inappropriate behaviour' },
  { value: 'suspicious_behaviour',    label: 'Suspicious behaviour' },
  { value: 'safety_concern',          label: 'Safety concern' },
  { value: 'spam',                    label: 'Spam' },
  { value: 'other',                   label: 'Something else' },
];
