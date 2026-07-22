'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronUp,
  HelpCircle,
  MessageSquareText,
  Plus,
  Sparkles,
} from 'lucide-react';

import {
  ConversationContextItem,
  INITIAL_MESSAGES,
  Message,
  PendingConfirmation,
} from './lib/conversation';

import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import StatusBar from './components/StatusBar';

interface ChatApiToolCall {
  name: string;
  arguments: Record<string, unknown> | null;
}

interface ChatApiResponse {
  reply?: string;
  toolCalls?: ChatApiToolCall[];
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
  requiresReauth?: boolean;
  error?: string;
}

interface HistoryApiMessage {
  id?: string;
  sender?: 'user' | 'assistant';
  text?: string;
  timestamp?: string;
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
}

interface ConversationHistoryResponse {
  conversationId?: string;
  messages?: HistoryApiMessage[];
  hasMore?: boolean;
  requiresReauth?: boolean;
  error?: string;
}

interface SidebarConversation {
  id: string;
  title: string | null;
  preview: string | null;
  updated_at: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>(() => [...INITIAL_MESSAGES]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());
  const [isAssistantReplying, setIsAssistantReplying] = useState<boolean>(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [googleStatus, setGoogleStatus] = useState({
    connected: false,
    checking: true,
  });
  const [activityLogs, setActivityLogs] = useState<string[]>([
    'System boot completed.',
    'OpenAI tool router ready.',
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputDisabledReason = googleStatus.checking
    ? 'Checking Google connection...'
    : !googleStatus.connected
      ? 'Connect Google Account to enable live Calendar and Tasks chat.'
      : isAssistantReplying
        ? 'Assistant is crafting a response...'
        : undefined;

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setConversations(Array.isArray(data.conversations) ? data.conversations : []);
      }
    } catch {
      // Sidebar list is non-critical
    }
  }, []);

  const loadConversationMessages = useCallback(async (conversationId?: string) => {
    try {
      const url = conversationId
        ? `/api/conversations/history?limit=50&conversationId=${encodeURIComponent(conversationId)}`
        : '/api/conversations/history?limit=50';
      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) return;

      const data = (await response.json()) as ConversationHistoryResponse;
      const storedMessages = Array.isArray(data.messages)
        ? data.messages.map(toMessageFromHistoryApi).filter((message): message is Message => message !== null)
        : [];

      if (data.conversationId) {
        setActiveConversationId(data.conversationId);
      }

      setMessages([...INITIAL_MESSAGES, ...storedMessages]);
      setHasMoreMessages(data.hasMore ?? false);
    } catch {
      // Keep the initial local welcome message if history cannot be loaded.
    }
  }, []);

  useEffect(() => {
    loadConversationMessages();
    loadConversations();
  }, [loadConversationMessages, loadConversations]);

  const handleSwitchConversation = useCallback(async (conversationId: string) => {
    if (conversationId === activeConversationId || isAssistantReplying) return;
    setIsAssistantReplying(false);
    await loadConversationMessages(conversationId);
    addLog('Switched conversation.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, isAssistantReplying, loadConversationMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAssistantReplying]);

  const addLog = (log: string) => {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setActivityLogs((prev) => [`[${timestamp}] ${log}`, ...prev.slice(0, 14)]);
  };

  const handleSync = async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    addLog('Checking Google connection...');

    try {
      const response = await fetch('/api/auth/google/status', { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok || !data.connected) {
        throw new Error('Google account is not connected.');
      }

      setLastSynced(new Date());
      addLog('Google connection verified.');
    } catch (error) {
      addLog(error instanceof Error ? error.message : 'Unable to verify Calendar access.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleNewChat = async () => {
    setMessages([...INITIAL_MESSAGES]);
    setIsAssistantReplying(false);
    setHasMoreMessages(false);
    setActiveConversationId(null);
    addLog('Starting new conversation...');

    if (googleStatus.connected) {
      try {
        const response = await fetch('/api/conversations/new', { method: 'POST' });

        if (response.ok) {
          const data = await response.json();
          setActiveConversationId(data.conversationId ?? null);
          addLog('New conversation created.');
          loadConversations();
        } else {
          addLog('New conversation created locally (server sync skipped).');
        }
      } catch {
        addLog('New conversation created locally.');
      }
    }
  };

  const handleLoadOlderMessages = async () => {
    if (isLoadingMore || !hasMoreMessages) return;

    const nonWelcomeMessages = messages.filter((m) => m.id !== 'welcome');
    const oldestMessage = nonWelcomeMessages[0];
    if (!oldestMessage) return;

    setIsLoadingMore(true);

    try {
      const before = oldestMessage.timestamp.toISOString();
      const convParam = activeConversationId ? `&conversationId=${encodeURIComponent(activeConversationId)}` : '';
      const response = await fetch(`/api/conversations/history?limit=50&before=${encodeURIComponent(before)}${convParam}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        addLog('Failed to load earlier messages.');
        return;
      }

      const data = (await response.json()) as ConversationHistoryResponse;
      const olderMessages = Array.isArray(data.messages)
        ? data.messages.map(toMessageFromHistoryApi).filter((msg): msg is Message => msg !== null)
        : [];

      if (olderMessages.length > 0) {
        setMessages((prev) => {
          const welcomeMessages = prev.filter((m) => m.id === 'welcome');
          const existingMessages = prev.filter((m) => m.id !== 'welcome');
          return [...welcomeMessages, ...olderMessages, ...existingMessages];
        });
        addLog(`Loaded ${olderMessages.length} earlier messages.`);
      }

      setHasMoreMessages(data.hasMore ?? false);
    } catch {
      addLog('Failed to load earlier messages.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleJumpToMessage = (messageId: string) => {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const handleConnectionChange = useCallback((state: { connected: boolean; checking: boolean }) => {
    setGoogleStatus(state);
  }, []);

  const handleSendMessage = async (text: string) => {
    if (isAssistantReplying) return;

    if (!googleStatus.connected) {
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text,
        timestamp: new Date(),
      };
      const assistantMsg: Message = {
        id: `assistant-reauth-${Date.now()}`,
        sender: 'assistant',
        text: 'Connect your Google account first so I can safely read and update Calendar and Tasks.',
        status: 'error',
        action: 'reauth',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      addLog('Blocked chat send until Google account is connected.');
      return;
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date(),
    };
    const assistantMessageId = `assistant-${Date.now()}`;
    const pendingMsg: Message = {
      id: assistantMessageId,
      sender: 'assistant',
      text: 'Reasoning through Calendar and Tasks...',
      status: 'thinking',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setIsAssistantReplying(true);
    addLog(`User submitted: "${text.substring(0, 35)}${text.length > 35 ? '...' : ''}"`);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ChatApiResponse;

      if (!response.ok) {
        if (response.status === 401 && data.requiresReauth) {
          setGoogleStatus({ connected: false, checking: false });
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    text: data.reply ?? 'Please reconnect your Google account before I can work with Calendar or Tasks.',
                    status: 'error',
                    action: 'reauth',
                    toolActionText: undefined,
                    timestamp: new Date(),
                  }
                : message
            )
          );
          addLog('Google authorization is required before tools can run.');
          return;
        }

        throw new ChatRequestError(response.status >= 500 ? 'server' : 'request');
      }

      const toolActionText = formatToolActionText(data.toolCalls ?? []);
      const isError = Boolean(data.requiresReauth || data.error);

      if (data.requiresReauth) {
        setGoogleStatus({ connected: false, checking: false });
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                text: data.reply ?? 'Please reconnect your Google account before I can work with Calendar or Tasks.',
                status: 'error',
                action: 'reauth',
                toolActionText: undefined,
                contextItems: data.contextItems,
                pendingConfirmation: data.pendingConfirmation,
                timestamp: new Date(),
              }
              : message
          )
        );
        addLog('Google authorization is required before tools can run.');
        return;
      }

      if (toolActionText && !isError) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  text: 'Applying the requested Google action...',
                  status: 'tool-action',
                  toolActionText,
                  timestamp: new Date(),
                }
              : message
          )
        );
        await sleep(700);
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text: data.reply ?? 'I could not produce a response. Please try again.',
                status: isError ? 'error' : 'normal',
                toolActionText: undefined,
                action: undefined,
                contextItems: data.contextItems,
                pendingConfirmation: data.pendingConfirmation,
                timestamp: new Date(),
              }
            : message
        )
      );

      if (data.toolCalls?.length) {
        addLog(`Tool calls: ${data.toolCalls.map((toolCall) => toolCall.name).join(', ')}`);
        setLastSynced(new Date());
      }

      if (data.error) {
        addLog(`Assistant returned: ${data.error}`);
      } else {
        addLog('Assistant response completed.');
      }
    } catch (error) {
      const isRetryable = error instanceof ChatRequestError ? error.kind === 'server' : true;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text: isRetryable
                  ? 'The assistant request failed before I could finish. You can retry the same message.'
                  : 'The assistant could not read that request. Please revise it and try again.',
                status: 'error',
                action: isRetryable ? 'retry' : undefined,
                retryText: isRetryable ? text : undefined,
                timestamp: new Date(),
              }
            : message
        )
      );
      addLog('Assistant request failed.');
    } finally {
      setIsAssistantReplying(false);
      loadConversations();
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-gray-800 overflow-hidden font-sans">
      <aside className="hidden lg:flex flex-col w-80 bg-white border-r border-gray-200">
        <div className="p-6 border-b border-gray-150">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-gray-900 tracking-tight">
                Workspace AI
              </h1>
              <span className="text-[10px] font-mono font-medium tracking-wide text-gray-400 uppercase">
                Live Google Console
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div>
            <h2 className="px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Conversations
            </h2>
            {conversations.length > 0 ? (
              <div className="space-y-1.5">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => handleSwitchConversation(conv.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      conv.id === activeConversationId
                        ? 'border-indigo-200 bg-indigo-50/80'
                        : 'border-transparent bg-white hover:border-indigo-100 hover:bg-indigo-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquareText className={`h-3.5 w-3.5 flex-shrink-0 ${
                        conv.id === activeConversationId ? 'text-indigo-600' : 'text-indigo-400'
                      }`} />
                      <span className="truncate text-xs font-semibold text-slate-700">
                        {conv.preview || conv.title || 'New conversation'}
                      </span>
                    </div>
                    <span className="mt-1 block pl-5 text-[10px] font-mono text-slate-400">
                      {formatRelativeTime(conv.updated_at)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 text-xs leading-relaxed text-slate-400">
                Your conversations will appear here.
              </p>
            )}
          </div>

          <div>
            <h2 className="px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Conversation Controls
            </h2>
            <div className="space-y-2 px-1">
              <button
                onClick={handleNewChat}
                className="w-full inline-flex items-center justify-center space-x-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <h2 className="px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Activity Logs
            </h2>
            <div className="bg-slate-900 rounded-xl p-3.5 font-mono text-[10px] text-emerald-400 space-y-1.5 h-44 overflow-y-auto custom-scrollbar shadow-inner">
              {activityLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed opacity-90 truncate">
                  <span className="text-gray-500">&gt;</span> {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-gray-150 flex items-center space-x-3 text-xs text-gray-400">
          <HelpCircle className="w-4.5 h-4.5 text-gray-400 flex-shrink-0" />
          <p className="font-sans leading-normal">
            Ask natural-language questions to manage Google Calendar and Tasks live.
          </p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 relative">
        <div className="bg-white border-b border-gray-150 px-6 py-4 flex items-center justify-between lg:hidden shadow-xs">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <span className="font-display font-bold text-base text-gray-900">
              Workspace AI
            </span>
          </div>

          <button
            onClick={handleNewChat}
            title="New Chat"
            className="p-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-600"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <StatusBar
          lastSynced={lastSynced}
          onSync={handleSync}
          isSyncing={isSyncing}
          onConnectionChange={handleConnectionChange}
        />

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 custom-scrollbar bg-slate-50/50">
          <div className="max-w-4xl mx-auto space-y-2">
            {hasMoreMessages && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={handleLoadOlderMessages}
                  disabled={isLoadingMore}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-full hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {isLoadingMore ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Load earlier messages
                    </>
                  )}
                </button>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onRetry={handleSendMessage}
                />
              ))}
            </AnimatePresence>

            {isAssistantReplying && !messages[messages.length - 1]?.status && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center space-x-2 py-2 text-gray-400 pl-12"
              >
                <div className="flex space-x-1">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-gray-400 font-sans italic">Workspace AI is thinking...</span>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {!googleStatus.checking && !googleStatus.connected && (
          <div className="border-t border-amber-100 bg-amber-50 px-6 py-3">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 text-sm text-amber-900">
              <span>Connect Google before chatting so Calendar and Tasks actions can run live.</span>
              <a
                href="/api/auth/google"
                className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
              >
                Connect Google Account
              </a>
            </div>
          </div>
        )}

        <ChatInput
          onSendMessage={handleSendMessage}
          isDisabled={isAssistantReplying || googleStatus.checking || !googleStatus.connected}
          disabledReason={inputDisabledReason}
        />
      </main>
    </div>
  );
}

class ChatRequestError extends Error {
  constructor(readonly kind: 'request' | 'server') {
    super(`Chat request failed: ${kind}`);
    this.name = 'ChatRequestError';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function toMessageFromHistoryApi(value: HistoryApiMessage): Message | null {
  const timestamp = value.timestamp ? new Date(value.timestamp) : null;

  if (
    (value.sender !== 'user' && value.sender !== 'assistant') ||
    typeof value.text !== 'string' ||
    !timestamp ||
    Number.isNaN(timestamp.getTime())
  ) {
    return null;
  }

  return {
    id: value.id ?? `${value.sender}-${timestamp.getTime()}`,
    sender: value.sender,
    text: value.text,
    contextItems: value.contextItems,
    pendingConfirmation: value.pendingConfirmation,
    timestamp,
  };
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatToolActionText(toolCalls: ChatApiToolCall[]) {
  if (toolCalls.length === 0) {
    return undefined;
  }

  const labels: Record<string, string> = {
    create_event: '📅 Creating calendar event...',
    list_events: '📅 Reading calendar events...',
    update_event: '📅 Updating calendar event...',
    delete_event: '📅 Deleting calendar event...',
    create_task: '✅ Creating task...',
    list_tasks: '✅ Reading tasks...',
    update_task: '✅ Updating task...',
    delete_task: '✅ Deleting task...',
    find_event: '🔎 Finding calendar event...',
    find_task: '🔎 Finding task...',
  };
  const uniqueLabels = Array.from(new Set(toolCalls.map((toolCall) => labels[toolCall.name] ?? toolCall.name)));

  return uniqueLabels.length === 1 ? uniqueLabels[0] : uniqueLabels.join(' -> ');
}
