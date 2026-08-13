/**
 * The single Supabase client for the web app.
 *
 * For React Native / Expo, replace only this file:
 *
 *   import { createClient } from '@supabase/supabase-js';
 *   import AsyncStorage from '@react-native-async-storage/async-storage';
 *   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
 *     auth: { storage: AsyncStorage, autoRefreshToken: true,
 *             persistSession: true, detectSessionInUrl: false },
 *   });
 *
 * Every other module in /shared stays byte-for-byte identical.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isConfigured ? SUPABASE_ANON_KEY : 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);

export { isConfigured };

/** Normalises Postgres/PostgREST errors into a message worth showing a human. */
export function readableError(error) {
  if (!error) return 'Something went wrong.';
  const msg = error.message || String(error);
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Cannot reach the server. Check your connection and that Supabase is configured.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'That email and password combination did not match.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email address first — check your inbox.';
  if (/User already registered/i.test(msg)) return 'An account already exists for that email.';
  if (/duplicate key value/i.test(msg)) return 'That already exists.';
  // Our RPCs raise plain-language messages; strip the plpgsql noise.
  return msg.replace(/^.*?:\s*/, (m) => (m.length < 40 ? '' : m)).trim() || msg;
}
