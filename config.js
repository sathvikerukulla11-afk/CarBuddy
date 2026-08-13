/**
 * Supabase connection settings.
 *
 * Project: "ridealong" in Erukulla's Org, us-east-2 (the Supabase project name
 *          predates the CarBuddy rename; the ref cannot be changed)
 *
 * The publishable key is designed to be shipped in client code — every table is
 * protected by Row Level Security, so this key on its own grants nothing beyond
 * what the policies allow.
 *
 * NEVER put the service_role key in this file.
 *
 * The React Native / Expo app imports this same file.
 */
export const SUPABASE_URL = 'https://dlelgqrpfebevvkdlvba.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_EPBIZ_moqqrqT6Q-igQ86w_tCLokUDl';

export const isConfigured =
  !SUPABASE_URL.startsWith('__') && !SUPABASE_ANON_KEY.startsWith('__');
