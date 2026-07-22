import { NextResponse } from 'next/server';
import {
  AuthConfigurationError,
  clearSessionCookie,
  getSessionUserId,
} from '@/src/lib/auth/session';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { getUserById } from '@/src/lib/db/users';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      await clearSessionCookie();
      return NextResponse.json({ connected: false });
    }

    const user = await getUserById(userId);

    if (!user) {
      await clearSessionCookie();
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      email: user.google_email,
    });
  } catch (error) {
    if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) {
      return NextResponse.json({
        connected: false,
        configured: false,
        error: error.message,
      });
    }

    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json({
        connected: false,
        error: 'database_unavailable',
      });
    }

    return NextResponse.json({ connected: false });
  }
}
