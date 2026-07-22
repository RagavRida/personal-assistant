import 'server-only';

import { getSupabaseServerClient, toDatabaseError } from './client';

export interface UserRecord {
  id: string;
  google_email: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  created_at?: string;
}

export interface UpsertUserInput {
  googleEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number | string | Date;
}

export interface UpdateTokensInput {
  accessToken: string;
  tokenExpiry: number | string | Date;
}

export async function upsertUser({
  googleEmail,
  accessToken,
  refreshToken,
  tokenExpiry,
}: UpsertUserInput) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        google_email: googleEmail,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expiry: toTimestamp(tokenExpiry),
      },
      {
        onConflict: 'google_email',
      }
    )
    .select('id, google_email, access_token, refresh_token, token_expiry, created_at')
    .single();

  if (error || !data) {
    throw toDatabaseError(error, 'Unable to save Google account.');
  }

  return data as UserRecord;
}

export async function getUserById(id: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, google_email, access_token, refresh_token, token_expiry, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw toDatabaseError(error, 'Unable to load user.');
  }

  return (data as UserRecord | null) ?? null;
}

export async function getUserByEmail(email: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, google_email, access_token, refresh_token, token_expiry, created_at')
    .eq('google_email', email)
    .maybeSingle();

  if (error) {
    throw toDatabaseError(error, 'Unable to load user.');
  }

  return (data as UserRecord | null) ?? null;
}

export async function updateTokens(userId: string, { accessToken, tokenExpiry }: UpdateTokensInput) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .update({
      access_token: accessToken,
      token_expiry: toTimestamp(tokenExpiry),
    })
    .eq('id', userId)
    .select('id, google_email, access_token, refresh_token, token_expiry, created_at')
    .single();

  if (error || !data) {
    throw toDatabaseError(error, 'Unable to update Google tokens.');
  }

  return data as UserRecord;
}

function toTimestamp(value: number | string | Date) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  return value;
}
