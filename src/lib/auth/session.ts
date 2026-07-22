import 'server-only';

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { google } from 'googleapis';
import { getUserById, updateTokens, type UserRecord } from '@/src/lib/db/users';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

export const SESSION_COOKIE_NAME = 'workspace_ai_session';
export const LEGACY_GOOGLE_AUTH_COOKIE_NAME = 'google_oauth_session';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

interface SignedSessionPayload extends JWTPayload {
  userId?: string;
}

export class GoogleAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 401, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthConfigurationError extends GoogleAuthError {
  constructor(message: string) {
    super(message, 'AUTH_CONFIGURATION_ERROR', 500);
  }
}

export class AuthRequiredError extends GoogleAuthError {
  constructor(message = 'Google account is not connected.') {
    super(message, 'AUTH_REQUIRED', 401);
  }
}

export class AuthExpiredError extends GoogleAuthError {
  constructor(message = 'Google authorization expired. Please reconnect your account.', options?: ErrorOptions) {
    super(message, 'AUTH_EXPIRED', 401, options);
  }
}

export function createGoogleOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getSessionUserId() {
  const cookieStore = await cookies();
  const signedSession = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!signedSession) {
    return null;
  }

  return verifySessionCookie(signedSession);
}

export async function setSessionCookie(userId: string) {
  const signedSession = await signSessionCookie(userId);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, signedSession, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  clearCookieValue(cookieStore, LEGACY_GOOGLE_AUTH_COOKIE_NAME);
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();

  clearCookieValue(cookieStore, SESSION_COOKIE_NAME);
  clearCookieValue(cookieStore, LEGACY_GOOGLE_AUTH_COOKIE_NAME);
}

export async function getGoogleClient() {
  const userId = await getSessionUserId();

  if (!userId) {
    throw new AuthRequiredError();
  }

  const user = await getUserById(userId);

  if (!user) {
    await clearSessionCookie();
    throw new AuthRequiredError('Google account is no longer connected. Please reconnect.');
  }

  if (!user.refresh_token) {
    await clearSessionCookie();
    throw new AuthExpiredError('Google refresh token is missing. Please reconnect your account.');
  }

  const oauth2Client = createGoogleOAuthClient();
  const expiryDate = normalizeExpiryDate(user.token_expiry);

  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expiry_date: expiryDate,
  });

  if (!user.access_token || isAccessTokenExpired(expiryDate)) {
    try {
      const refreshedUser = await refreshGoogleAccessToken(oauth2Client, user);

      oauth2Client.setCredentials({
        access_token: refreshedUser.access_token,
        refresh_token: refreshedUser.refresh_token,
        expiry_date: normalizeExpiryDate(refreshedUser.token_expiry),
      });
    } catch (error) {
      await clearSessionCookie();
      throw new AuthExpiredError('Google token refresh failed. Please reconnect your account.', {
        cause: error,
      });
    }
  }

  return oauth2Client;
}

async function refreshGoogleAccessToken(oauth2Client: ReturnType<typeof createGoogleOAuthClient>, user: UserRecord) {
  const accessTokenResponse = await oauth2Client.getAccessToken();
  const credentials = oauth2Client.credentials;
  const accessToken = credentials.access_token ?? accessTokenResponse.token ?? user.access_token;
  const expiryDate = normalizeExpiryDate(credentials.expiry_date) ?? Date.now() + 60 * 60 * 1000;

  if (!accessToken) {
    throw new Error('Google refresh succeeded without returning an access token.');
  }

  return updateTokens(user.id, {
    accessToken,
    tokenExpiry: expiryDate,
  });
}

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REDIRECT_URI', redirectUri],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new AuthConfigurationError(`Missing Google OAuth environment variables: ${missing.join(', ')}`);
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

function getSessionCookieSecret() {
  const secret = process.env.SESSION_COOKIE_SECRET;

  if (!secret || secret.length < 32) {
    throw new AuthConfigurationError('SESSION_COOKIE_SECRET must be set to at least 32 characters.');
  }

  return new TextEncoder().encode(secret);
}

async function signSessionCookie(userId: string) {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSessionCookieSecret());
}

async function verifySessionCookie(signedSession: string) {
  try {
    const { payload } = await jwtVerify<SignedSessionPayload>(signedSession, getSessionCookieSecret());
    const userId = typeof payload.userId === 'string' ? payload.userId : payload.sub;

    return typeof userId === 'string' && userId.trim() ? userId : null;
  } catch {
    return null;
  }
}

function clearCookieValue(cookieStore: Awaited<ReturnType<typeof cookies>>, name: string) {
  cookieStore.set(name, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function isAccessTokenExpired(expiryDate?: number) {
  return !expiryDate || expiryDate - Date.now() <= TOKEN_REFRESH_SKEW_MS;
}

function normalizeExpiryDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
