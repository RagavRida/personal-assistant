import 'server-only';

import type { PendingConfirmation, ConversationContextItem } from '@/src/lib/openai/chat';
import { getSupabaseServerClient, toDatabaseError } from './client';

export type StoredMessageRole = 'user' | 'assistant' | 'tool';

export interface ConversationRecord {
  id: string;
  user_id: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: StoredMessageRole;
  content: string;
  tool_calls?: MessageMetadata | null;
  created_at: string;
}

export interface MessageMetadata {
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown> | null;
  }>;
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
  error?: string;
}

export async function createConversation(userId: string, title?: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title,
    })
    .select('id, user_id, title, created_at, updated_at')
    .single();

  if (error || !data) {
    throw toDatabaseError(error, 'Unable to create conversation.');
  }

  return data as ConversationRecord;
}

export async function getOrCreateActiveConversation(userId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('id, user_id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toDatabaseError(error, 'Unable to load conversation.');
  }

  if (data) {
    return data as ConversationRecord;
  }

  return createConversation(userId);
}

export interface PaginatedMessages {
  messages: StoredMessage[];
  hasMore: boolean;
}

export async function getConversationMessages(
  conversationId: string,
  options?: { limit?: number; before?: string }
): Promise<PaginatedMessages> {
  const supabase = getSupabaseServerClient();
  const limit = options?.limit ?? 50;
  const fetchCount = limit + 1;

  let query = supabase
    .from('messages')
    .select('id, conversation_id, role, content, tool_calls, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(fetchCount);

  if (options?.before) {
    query = query.lt('created_at', options.before);
  }

  const { data, error } = await query;

  if (error) {
    throw toDatabaseError(error, 'Unable to load conversation messages.');
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    messages: page.reverse() as StoredMessage[],
    hasMore,
  };
}

export async function appendMessage(
  conversationId: string,
  {
    role,
    content,
    toolCalls,
  }: {
    role: StoredMessageRole;
    content: string;
    toolCalls?: MessageMetadata | null;
  }
) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      tool_calls: toolCalls ?? null,
    })
    .select('id, conversation_id, role, content, tool_calls, created_at')
    .single();

  if (error || !data) {
    throw toDatabaseError(error, 'Unable to save message.');
  }

  return data as StoredMessage;
}
