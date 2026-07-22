import { NextResponse } from 'next/server';
import { clearSessionCookie, getSessionUserId } from '@/src/lib/auth/session';
import { createConversation } from '@/src/lib/db/conversations';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { getUserById } from '@/src/lib/db/users';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', requiresReauth: true },
        { status: 401 }
      );
    }

    const user = await getUserById(userId);

    if (!user) {
      await clearSessionCookie();
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', requiresReauth: true },
        { status: 401 }
      );
    }

    const conversation = await createConversation(user.id);

    return NextResponse.json({
      conversationId: conversation.id,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseUnavailableError) {
      console.error('[Database] New conversation failed:', error.message);
      return NextResponse.json(
        { error: 'database_unavailable' },
        { status: 503 }
      );
    }

    console.error('[Conversations] Unexpected failure:', error);
    return NextResponse.json(
      { error: 'conversation_creation_failed' },
      { status: 500 }
    );
  }
}
