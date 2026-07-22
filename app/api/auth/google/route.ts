import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleOAuthClient,
  GoogleAuthError,
  GOOGLE_OAUTH_SCOPES,
} from '@/src/lib/auth/session';
import { getRequestOrigin } from '@/src/lib/auth/redirect';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const oauth2Client = createGoogleOAuthClient();
    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_OAUTH_SCOPES,
      include_granted_scopes: true,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      const redirectUrl = new URL('/', getRequestOrigin(request));
      redirectUrl.searchParams.set('google_auth_error', error.code.toLowerCase());
      return NextResponse.redirect(redirectUrl);
    }

    throw error;
  }
}
