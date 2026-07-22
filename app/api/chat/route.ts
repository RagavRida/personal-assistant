import { NextRequest, NextResponse } from 'next/server';
import {
  runAssistantChat,
  type AssistantChatResult,
  type ClientChatMessage,
  type ConversationContextItem,
  type PendingConfirmation,
} from '@/src/lib/openai/chat';
import { clearSessionCookie, getSessionUserId } from '@/src/lib/auth/session';
import {
  appendMessage,
  getConversationMessages,
  getOrCreateActiveConversation,
  type MessageMetadata,
  type StoredMessage,
} from '@/src/lib/db/conversations';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { getUserById } from '@/src/lib/db/users';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let message = '';

  try {
    const body = await request.json();
    message = typeof body?.message === 'string' ? body.message.trim() : '';
    const clientTimeZone = typeof body?.timeZone === 'string' ? body.timeZone : undefined;
    if (clientTimeZone) {
      process.env.APP_TIME_ZONE = clientTimeZone;
    }
  } catch {
    return NextResponse.json(
      {
        reply: 'I could not read that chat request. Please try again.',
        toolCalls: [],
        error: 'invalid_request',
      },
      { status: 400 }
    );
  }

  if (!message) {
    return NextResponse.json(
      {
        reply: 'Please send a message for the assistant to handle.',
        toolCalls: [],
        error: 'missing_message',
      },
      { status: 400 }
    );
  }

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
    const { messages: storedMessages } = await getConversationMessages(conversation.id, { limit: 20 });
    const history = storedMessages.map(toClientChatMessage).filter((item): item is ClientChatMessage => item !== null);

    await appendMessage(conversation.id, {
      role: 'user',
      content: message,
    });

    const result = await runAssistantChat({ message, history });

    await appendMessage(conversation.id, {
      role: 'assistant',
      content: result.reply,
      toolCalls: toMessageMetadata(result),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseUnavailableError) {
      console.error('[Database] Chat storage failed:', error.message);
      return NextResponse.json({
        reply: 'Assistant is temporarily unavailable because conversation storage is not reachable. Please check the database configuration and try again.',
        toolCalls: [],
        error: 'assistant_unavailable',
      });
    }

    console.error('[Chat API] Unexpected failure:', error);
    return NextResponse.json({
      reply: 'Assistant is temporarily unavailable. Please try again shortly.',
      toolCalls: [],
      error: 'assistant_unavailable',
    });
  }
}

function authRequiredResponse() {
  return NextResponse.json(
    {
      reply: 'Please reconnect your Google account before I can work with Calendar or Tasks.',
      toolCalls: [],
      requiresReauth: true,
      error: 'AUTH_REQUIRED',
    },
    { status: 401 }
  );
}

function toClientChatMessage(message: StoredMessage): ClientChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }

  const metadata = normalizeMessageMetadata(message.tool_calls);

  return {
    id: message.id,
    role: message.role,
    sender: message.role,
    content: message.content,
    text: message.content,
    contextItems: metadata?.contextItems,
    pendingConfirmation: metadata?.pendingConfirmation,
  };
}

function toMessageMetadata(result: AssistantChatResult): MessageMetadata | null {
  const metadata: MessageMetadata = {
    toolCalls: result.toolCalls,
    contextItems: result.contextItems,
    pendingConfirmation: result.pendingConfirmation,
    error: result.error,
  };

  return Object.values(metadata).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null
  )
    ? metadata
    : null;
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
