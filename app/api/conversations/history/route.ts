import { NextResponse } from 'next/server';
import { clearSessionCookie, getSessionUserId } from '@/src/lib/auth/session';
import {
  getConversationMessages,
  getOrCreateActiveConversation,
  type MessageMetadata,
  type StoredMessage,
} from '@/src/lib/db/conversations';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { getUserById } from '@/src/lib/db/users';
import type { ConversationContextItem, PendingConfirmation } from '@/src/lib/openai/chat';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      return authRequiredResponse();
    }

    const user = await getUserById(userId);

    if (!user) {
      await clearSessionCookie();
      return authRequiredResponse();
    }

    const conversation = await getOrCreateActiveConversation(user.id);
    const storedMessages = await getConversationMessages(conversation.id);

    return NextResponse.json({
      conversationId: conversation.id,
      messages: storedMessages.map(toClientMessage).filter((message) => message !== null),
    });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseUnavailableError) {
      console.error('[Database] Conversation history failed:', error.message);
      return NextResponse.json(
        {
          messages: [],
          error: 'database_unavailable',
        },
        { status: 503 }
      );
    }

    console.error('[Conversation History] Unexpected failure:', error);
    return NextResponse.json(
      {
        messages: [],
        error: 'history_unavailable',
      },
      { status: 500 }
    );
  }
}

function authRequiredResponse() {
  return NextResponse.json(
    {
      messages: [],
      requiresReauth: true,
      error: 'AUTH_REQUIRED',
    },
    { status: 401 }
  );
}

function toClientMessage(message: StoredMessage) {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }

  const metadata = normalizeMessageMetadata(message.tool_calls);

  return {
    id: message.id,
    sender: message.role,
    text: message.content,
    timestamp: message.created_at,
    contextItems: metadata?.contextItems,
    pendingConfirmation: metadata?.pendingConfirmation,
  };
}

function normalizeMessageMetadata(value: unknown): MessageMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as {
    toolCalls?: unknown;
    contextItems?: unknown;
    pendingConfirmation?: unknown;
    error?: unknown;
  };

  return {
    toolCalls: Array.isArray(candidate.toolCalls) ? (candidate.toolCalls as MessageMetadata['toolCalls']) : undefined,
    contextItems: Array.isArray(candidate.contextItems)
      ? (candidate.contextItems as ConversationContextItem[])
      : undefined,
    pendingConfirmation:
      candidate.pendingConfirmation && typeof candidate.pendingConfirmation === 'object'
        ? (candidate.pendingConfirmation as PendingConfirmation)
        : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
  };
}
