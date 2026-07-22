import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export class DatabaseConfigurationError extends Error {
  readonly code = 'DATABASE_CONFIGURATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DatabaseUnavailableError extends Error {
  readonly code = 'DATABASE_UNAVAILABLE';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function getSupabaseServerClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new DatabaseConfigurationError(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

export function toDatabaseError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return new DatabaseUnavailableError(message || fallback, {
    cause: error,
  });
}
