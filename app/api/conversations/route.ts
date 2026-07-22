import { NextResponse } from 'next/server';
import { clearSessionCookie, getSessionUserId } from '@/src/lib/auth/session';
import { listConversations } from '@/src/lib/db/conversations';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { getUserById } from '@/src/lib/db/users';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      return NextResponse.json(
        { conversations: [], error: 'AUTH_REQUIRED', requiresReauth: true },
        { status: 401 }
      );
    }

    const user = await getUserById(userId);

    if (!user) {
      await clearSessionCookie();
      return NextResponse.json(
        { conversations: [], error: 'AUTH_REQUIRED', requiresReauth: true },
        { status: 401 }
      );
    }

    const conversations = await listConversations(user.id);

    return NextResponse.json({ conversations });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseUnavailableError) {
      console.error('[Database] List conversations failed:', error.message);
      return NextResponse.json(
        { conversations: [], error: 'database_unavailable' },
        { status: 503 }
      );
    }

    console.error('[Conversations] Unexpected failure:', error);
    return NextResponse.json(
      { conversations: [], error: 'list_failed' },
      { status: 500 }
    );
  }
}
