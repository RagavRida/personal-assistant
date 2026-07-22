import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { google } from 'googleapis';
import {
  AuthConfigurationError,
  clearSessionCookie,
  createGoogleOAuthClient,
  setSessionCookie,
} from '@/src/lib/auth/session';
import { getRequestOrigin } from '@/src/lib/auth/redirect';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { upsertUser } from '@/src/lib/db/users';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');

  if (providerError) {
    return redirectHome(request, 'google_auth_error', providerError);
  }

  if (!code) {
    return redirectHome(request, 'google_auth_error', 'missing_code');
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      await clearSessionCookie();
      const reauthUrl = new URL('/api/auth/google', getRequestOrigin(request));
      reauthUrl.searchParams.set('reason', 'missing_refresh_token');
      return NextResponse.redirect(reauthUrl);
    }

    if (!tokens.access_token) {
      return redirectHome(request, 'google_auth_error', 'missing_access_token');
    }

    const googleEmail = await getGoogleEmail(tokens.id_token, oauth2Client);
    const user = await upsertUser({
      googleEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ?? Date.now() + 60 * 60 * 1000,
    });
    await setSessionCookie(user.id);

    return redirectHome(request, 'google_auth', 'success');
  } catch (error) {
    console.error('[Google OAuth] Callback failed:', error);

    if (error instanceof AuthConfigurationError) {
      return redirectHome(request, 'google_auth_error', 'auth_configuration_error');
    }

    if (error instanceof DatabaseConfigurationError) {
      return redirectHome(request, 'google_auth_error', 'database_configuration_error');
    }

    if (error instanceof DatabaseUnavailableError) {
      return redirectHome(request, 'google_auth_error', 'database_unavailable');
    }

    return redirectHome(request, 'google_auth_error', 'token_exchange_failed');
  }
}

function redirectHome(request: NextRequest, key: string, value: string) {
  const redirectUrl = new URL('/', getRequestOrigin(request));
  redirectUrl.searchParams.set(key, value);
  return NextResponse.redirect(redirectUrl);
}

async function getGoogleEmail(idToken: string | null | undefined, oauth2Client: ReturnType<typeof createGoogleOAuthClient>) {
  if (idToken) {
    const payload = decodeJwt(idToken);
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    if (email) {
      return email;
    }
  }

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email) {
    throw new Error('Google account email was not returned.');
  }

  return data.email;
}
