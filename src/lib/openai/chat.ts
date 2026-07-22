import 'server-only';

import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import {
  AuthConfigurationError,
  AuthExpiredError,
  AuthRequiredError,
} from '@/src/lib/auth/session';
import { DatabaseConfigurationError, DatabaseUnavailableError } from '@/src/lib/db/client';
import { buildSystemPrompt } from './systemPrompt';
import { executeToolCall, getToolCallArgumentsForTrace } from './executeToolCall';
import { calendarTaskTools } from './tools';

const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 15_000;
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;

export interface ClientChatMessage {
  role?: 'user' | 'assistant';
  sender?: 'user' | 'assistant';
  content?: string;
  text?: string;
  id?: string;
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
}

export interface ToolCallTrace {
  name: string;
  arguments: Record<string, unknown> | null;
}

interface DebugStep {
  assistantToolCalls?: ToolCallTrace[];
  toolResults?: Array<{
    tool_call_id: string;
    content: string;
  }>;
  assistantReply?: string;
}

interface RecoverableNotFoundResult {
  userMessage: string;
}

interface SuccessfulEventListResult {
  kind: 'events';
  events: Array<{
    event_id?: string;
    title?: string;
    start?: string;
    end?: string;
  }>;
}

interface SuccessfulTaskListResult {
  kind: 'tasks';
  tasks: Array<{
    task_id?: string;
    title?: string;
    due?: string;
    status?: string;
  }>;
}

type SuccessfulListResult = SuccessfulEventListResult | SuccessfulTaskListResult;

export interface ConversationContextItem {
  type: 'event' | 'task';
  id: string;
  title: string;
  start?: string;
  end?: string;
  due?: string;
  status?: string;
}

export interface PendingConfirmation {
  type: 'delete_event' | 'delete_task';
  id: string;
  title: string;
  start?: string;
  end?: string;
  due?: string;
}

export interface AssistantChatResult {
  reply: string;
  toolCalls: ToolCallTrace[];
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
  requiresReauth?: boolean;
  error?: string;
  debug?: {
    model: string;
    iterations: number;
    steps: DebugStep[];
  };
}

interface RunAssistantChatOptions {
  message: string;
  history?: ClientChatMessage[];
  debug?: boolean;
}

class OpenAIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIConfigurationError';
  }
}

class OpenAIRequestTimeoutError extends Error {
  constructor() {
    super('OpenAI request timed out.');
    this.name = 'OpenAIRequestTimeoutError';
  }
}

class OpenAIUnavailableError extends Error {
  constructor(message = 'OpenAI request failed.') {
    super(message);
    this.name = 'OpenAIUnavailableError';
  }
}

export async function runAssistantChat({
  message,
  history = [],
  debug = false,
}: RunAssistantChatOptions): Promise<AssistantChatResult> {
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const timeZone = process.env.APP_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: buildSystemPrompt({ now: new Date(), timeZone }),
    },
    ...normalizeHistory(history),
    {
      role: 'user',
      content: message,
    },
  ];
  const toolCalls: ToolCallTrace[] = [];
  const debugSteps: DebugStep[] = [];
  const recoverableNotFoundResults: RecoverableNotFoundResult[] = [];
  const successfulListResults: SuccessfulListResult[] = [];
  const allowDestructiveActions = isConfirmedDeleteTurn(message, history);

  try {
    const deterministicResult = await handleDeterministicConversationAction(message, history, timeZone, debug, model);

    if (deterministicResult) {
      return deterministicResult;
    }

    const client = getOpenAIClient();

    for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
      const completion = await createCompletion(client, model, messages);
      const assistantMessage = completion.choices[0]?.message;

      if (!assistantMessage) {
        return fallbackResult('The assistant returned an empty response. Please try again.', toolCalls, {
          error: 'malformed_model_response',
          debug,
          model,
          iterations: iteration,
          steps: debugSteps,
        });
      }

      if (assistantMessage.tool_calls?.length) {
        const functionToolCalls = assistantMessage.tool_calls.filter(isFunctionToolCall);

        if (functionToolCalls.length !== assistantMessage.tool_calls.length) {
          return fallbackResult('The assistant tried to use an unsupported tool. Please try again.', toolCalls, {
            error: 'unsupported_tool_call',
            debug,
            model,
            iterations: iteration,
            steps: debugSteps,
          });
        }

        const assistantToolCalls = functionToolCalls.map((toolCall) => ({
          name: toolCall.function.name,
          arguments: getToolCallArgumentsForTrace(toolCall.function.arguments),
        }));
        toolCalls.push(...assistantToolCalls);
        debugSteps.push({ assistantToolCalls });

        messages.push({
          role: 'assistant',
          content: assistantMessage.content ?? null,
          tool_calls: assistantMessage.tool_calls,
        } as ChatCompletionAssistantMessageParam);

        const toolResultMessages = [];

        for (const toolCall of functionToolCalls) {
          const toolResultMessage = await executeToolCall(toolCall, {
            allowDestructiveActions,
          });
          messages.push(toolResultMessage);
          const recoverableNotFoundResult = parseRecoverableNotFoundToolResult(toolResultMessage.content);
          const successfulListResult = parseSuccessfulListToolResult(toolCall.function.name, toolResultMessage.content);

          if (recoverableNotFoundResult) {
            recoverableNotFoundResults.push(recoverableNotFoundResult);
          }

          if (successfulListResult) {
            successfulListResults.push(successfulListResult);
          }

          toolResultMessages.push({
            tool_call_id: toolResultMessage.tool_call_id,
            content: String(toolResultMessage.content),
          });
        }

        debugSteps.push({ toolResults: toolResultMessages });
        const immediateReply = formatImmediateToolResultReply(
          recoverableNotFoundResults,
          successfulListResults,
          message,
          timeZone,
          toolCalls
        );

        if (immediateReply) {
          debugSteps.push({ assistantReply: immediateReply });

          return {
            reply: immediateReply,
            toolCalls,
            ...getLatestListContextPayload(successfulListResults),
            ...(debug ? { debug: { model, iterations: iteration, steps: debugSteps } } : {}),
          };
        }

        continue;
      }

      if (typeof assistantMessage.content !== 'string' || !assistantMessage.content.trim()) {
        return fallbackResult('The assistant could not produce a clear response. Please try again.', toolCalls, {
          error: 'malformed_model_response',
          debug,
          model,
          iterations: iteration,
          steps: debugSteps,
        });
      }

      const reply = rewriteToolResultMismatchWording(
        assistantMessage.content,
        recoverableNotFoundResults,
        successfulListResults,
        message,
        timeZone,
        toolCalls
      );
      debugSteps.push({ assistantReply: reply });

      return {
        reply,
        toolCalls,
        ...getLatestListContextPayload(successfulListResults),
        ...(debug ? { debug: { model, iterations: iteration, steps: debugSteps } } : {}),
      };
    }

    return fallbackResult('I got stuck trying to use tools for that request. Please try again with a little more detail.', toolCalls, {
      error: 'tool_loop_exceeded',
      debug,
      model,
      iterations: MAX_TOOL_ITERATIONS,
      steps: debugSteps,
    });
  } catch (error) {
    if (error instanceof AuthExpiredError || error instanceof AuthRequiredError) {
      return {
        reply: 'Please reconnect your Google account before I can work with Calendar or Tasks.',
        toolCalls,
        requiresReauth: true,
        error: error.code,
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    if (error instanceof AuthConfigurationError) {
      console.error('[Google Auth] Configuration error while executing assistant tool:', error.message);
      return {
        reply: 'Assistant is unavailable right now. Please check the server configuration and try again.',
        toolCalls,
        error: 'assistant_unavailable',
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    if (error instanceof OpenAIConfigurationError) {
      console.error('[OpenAI] Configuration error:', error.message);
      return {
        reply: 'Assistant is unavailable right now. Please check the server configuration and try again.',
        toolCalls,
        error: 'assistant_unavailable',
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    if (error instanceof OpenAIRequestTimeoutError) {
      console.error('[OpenAI] Request timed out after %dms.', OPENAI_TIMEOUT_MS);
      return {
        reply: 'The assistant took too long to respond. Please try again.',
        toolCalls,
        error: 'assistant_timeout',
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    if (error instanceof OpenAIUnavailableError) {
      console.error('[OpenAI] Request failed:', error.message);
      return {
        reply: 'Assistant is unavailable right now. Please try again shortly.',
        toolCalls,
        error: 'assistant_unavailable',
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseUnavailableError) {
      console.error('[Database] Assistant storage/token lookup failed:', error.message);
      return {
        reply: 'Assistant is temporarily unavailable because storage is not reachable. Please check the database configuration and try again.',
        toolCalls,
        error: 'assistant_unavailable',
        ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
      };
    }

    console.error('[Assistant] Unexpected chat loop error:', error);
    return {
      reply: 'I hit a problem while handling that request. Please try again.',
      toolCalls,
      error: 'assistant_error',
      ...(debug ? { debug: { model, iterations: debugSteps.length, steps: debugSteps } } : {}),
    };
  }
}

function isFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall
): toolCall is ChatCompletionMessageFunctionToolCall {
  return toolCall.type === 'function';
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIConfigurationError('OPENAI_API_KEY is missing.');
  }

  return new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
  });
}

async function createCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[]
) {
  try {
    return await client.chat.completions.create({
      model,
      messages,
      tools: calendarTaskTools,
      tool_choice: 'auto',
    });
  } catch (error) {
    const candidate = error as { status?: number; name?: string; message?: string };

    if (candidate.name?.toLowerCase().includes('timeout')) {
      throw new OpenAIRequestTimeoutError();
    }

    if (candidate.status === 401 || candidate.status === 403) {
      throw new OpenAIUnavailableError('OpenAI authentication failed. Check OPENAI_API_KEY.');
    }

    throw new OpenAIUnavailableError(candidate.message ?? 'OpenAI request failed.');
  }
}

function normalizeHistory(history: ClientChatMessage[]): ChatCompletionMessageParam[] {
  return history
    .filter((item) => item.id !== 'welcome')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => {
      const role = item.role ?? item.sender;
      const content = item.content ?? item.text;

      if ((role !== 'user' && role !== 'assistant') || !content?.trim()) {
        return null;
      }

      return {
        role,
        content,
      } as ChatCompletionMessageParam;
    })
    .filter((item): item is ChatCompletionMessageParam => item !== null);
}

function isConfirmedDeleteTurn(message: string, history: ClientChatMessage[]) {
  if (!isAffirmativeDeleteConfirmation(message)) {
    return false;
  }

  const lastAssistantMessage = [...history].reverse().find((item) => {
    const role = item.role ?? item.sender;
    return role === 'assistant' && Boolean((item.content ?? item.text)?.trim());
  });
  const content = lastAssistantMessage?.content ?? lastAssistantMessage?.text ?? '';

  return /delete|remove|cancel|confirmation|confirm/i.test(content) && /\?/.test(content);
}

function isAffirmativeDeleteConfirmation(message: string) {
  return /\b(yes|yep|yeah|confirm|confirmed|proceed|go ahead|do it|delete it|remove it|cancel it)\b/i.test(message);
}

function parseRecoverableNotFoundToolResult(content: unknown): RecoverableNotFoundResult | null {
  if (typeof content !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as {
      errorCode?: unknown;
      notFound?: unknown;
      recoverable?: unknown;
      userMessage?: unknown;
    };

    const isRecoverableNotFound =
      parsed.notFound === true &&
      parsed.recoverable === true &&
      (parsed.errorCode === 'EVENT_NOT_FOUND' || parsed.errorCode === 'TASK_NOT_FOUND');

    if (!isRecoverableNotFound || typeof parsed.userMessage !== 'string' || !parsed.userMessage.trim()) {
      return null;
    }

    return {
      userMessage: parsed.userMessage,
    };
  } catch {
    return null;
  }
}

function parseSuccessfulListToolResult(toolName: string, content: unknown): SuccessfulListResult | null {
  if (typeof content !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as {
      ok?: unknown;
      events?: unknown;
      tasks?: unknown;
    };

    if (parsed.ok !== true) {
      return null;
    }

    if (toolName === 'list_events' && Array.isArray(parsed.events)) {
      return {
        kind: 'events',
        events: parsed.events.filter(isRecord).map((event) => ({
          event_id: typeof event.event_id === 'string' ? event.event_id : undefined,
          title: typeof event.title === 'string' ? event.title : undefined,
          start: typeof event.start === 'string' ? event.start : undefined,
          end: typeof event.end === 'string' ? event.end : undefined,
        })),
      };
    }

    if (toolName === 'list_tasks' && Array.isArray(parsed.tasks)) {
      return {
        kind: 'tasks',
        tasks: parsed.tasks.filter(isRecord).map((task) => ({
          task_id: typeof task.task_id === 'string' ? task.task_id : undefined,
          title: typeof task.title === 'string' ? task.title : undefined,
          due: typeof task.due === 'string' ? task.due : undefined,
          status: typeof task.status === 'string' ? task.status : undefined,
        })),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function handleDeterministicConversationAction(
  message: string,
  history: ClientChatMessage[],
  timeZone: string,
  debug: boolean,
  model: string
): Promise<AssistantChatResult | null> {
  const pendingConfirmation = getPendingDeleteConfirmationForAffirmation(message, history);

  if (pendingConfirmation) {
    return executeConfirmedDelete(pendingConfirmation, debug, model);
  }

  const contextualDelete = buildContextualDeleteConfirmation(message, history, timeZone);

  if (contextualDelete) {
    return contextualDelete;
  }

  return null;
}

function getPendingDeleteConfirmationForAffirmation(message: string, history: ClientChatMessage[]) {
  if (!isAffirmativeDeleteConfirmation(message)) {
    return null;
  }

  const lastAssistantMessage = [...history].reverse().find((item) => {
    const role = item.role ?? item.sender;
    return role === 'assistant';
  });

  return lastAssistantMessage?.pendingConfirmation ?? null;
}

async function executeConfirmedDelete(
  pendingConfirmation: PendingConfirmation,
  debug: boolean,
  model: string
): Promise<AssistantChatResult> {
  const args =
    pendingConfirmation.type === 'delete_event'
      ? { event_id: pendingConfirmation.id }
      : { task_id: pendingConfirmation.id };
  const toolCall: ChatCompletionMessageFunctionToolCall = {
    id: `confirmed-${pendingConfirmation.type}`,
    type: 'function',
    function: {
      name: pendingConfirmation.type,
      arguments: JSON.stringify(args),
    },
  };
  const toolResultMessage = await executeToolCall(toolCall, {
    allowDestructiveActions: true,
  });
  const toolResult = parseToolResultJson(toolResultMessage.content);
  const toolCalls = [
    {
      name: pendingConfirmation.type,
      arguments: args,
    },
  ];
  const debugSteps: DebugStep[] = [
    {
      assistantToolCalls: toolCalls,
    },
    {
      toolResults: [
        {
          tool_call_id: toolResultMessage.tool_call_id,
          content: String(toolResultMessage.content),
        },
      ],
    },
  ];

  if (toolResult?.ok === true) {
    const reply =
      pendingConfirmation.type === 'delete_event'
        ? `Deleted "${pendingConfirmation.title}" from your calendar.`
        : `Deleted "${pendingConfirmation.title}" from your tasks.`;

    debugSteps.push({ assistantReply: reply });

    return {
      reply,
      toolCalls,
      ...(debug ? { debug: { model, iterations: 0, steps: debugSteps } } : {}),
    };
  }

  const reply =
    typeof toolResult?.userMessage === 'string' && toolResult.userMessage.trim()
      ? toolResult.userMessage
      : `I couldn't delete "${pendingConfirmation.title}". Please refresh your Google data and try again.`;
  debugSteps.push({ assistantReply: reply });

  return {
    reply,
    toolCalls,
    error: typeof toolResult?.errorCode === 'string' ? toolResult.errorCode : 'delete_failed',
    ...(debug ? { debug: { model, iterations: 0, steps: debugSteps } } : {}),
  };
}

function parseToolResultJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildContextualDeleteConfirmation(
  message: string,
  history: ClientChatMessage[],
  timeZone: string
): AssistantChatResult | null {
  if (!isDeleteRequest(message)) {
    return null;
  }

  const contextItems = getLatestConversationContextItems(history);

  if (contextItems.length === 0) {
    return null;
  }

  const requestedType = getRequestedDeleteItemType(message);
  const candidates = requestedType ? contextItems.filter((item) => item.type === requestedType) : contextItems;

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1) {
    const lines = candidates.map((item) => `- ${formatContextItemLabel(item, timeZone)}`);

    return {
      reply: `I found ${formatCount(candidates.length, candidates[0].type === 'event' ? 'matching event' : 'matching task')}:\n${lines.join('\n')}\n\nWhich one should I delete?`,
      toolCalls: [],
      contextItems,
    };
  }

  const item = candidates[0];
  const pendingConfirmation: PendingConfirmation =
    item.type === 'event'
      ? {
          type: 'delete_event',
          id: item.id,
          title: item.title,
          start: item.start,
          end: item.end,
        }
      : {
          type: 'delete_task',
          id: item.id,
          title: item.title,
          due: item.due,
        };

  return {
    reply: formatDeleteConfirmationQuestion(pendingConfirmation, timeZone),
    toolCalls: [],
    contextItems,
    pendingConfirmation,
  };
}

function getLatestConversationContextItems(history: ClientChatMessage[]) {
  const lastContextMessage = [...history].reverse().find((item) => {
    const role = item.role ?? item.sender;
    return role === 'assistant' && Array.isArray(item.contextItems) && item.contextItems.length > 0;
  });

  return (lastContextMessage?.contextItems ?? []).filter(isConversationContextItem);
}

function isConversationContextItem(item: unknown): item is ConversationContextItem {
  if (!isRecord(item)) {
    return false;
  }

  return (
    (item.type === 'event' || item.type === 'task') &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0
  );
}

function isDeleteRequest(message: string) {
  return /\b(delete|remove|cancel)\b/i.test(message);
}

function getRequestedDeleteItemType(message: string): ConversationContextItem['type'] | null {
  if (/\b(task|todo|to-do)\b/i.test(message)) {
    return 'task';
  }

  if (/\b(meeting|event|appointment|calendar)\b/i.test(message)) {
    return 'event';
  }

  return null;
}

function formatDeleteConfirmationQuestion(pendingConfirmation: PendingConfirmation, timeZone: string) {
  if (pendingConfirmation.type === 'delete_event') {
    const timeText = pendingConfirmation.start
      ? ` scheduled for ${formatEventTime(pendingConfirmation.start, pendingConfirmation.end, timeZone)}`
      : '';
    return `Are you sure you want to delete "${pendingConfirmation.title}"${timeText}?`;
  }

  const dueText = pendingConfirmation.due ? ` due ${formatDateTime(pendingConfirmation.due, timeZone)}` : '';
  return `Are you sure you want to delete the task "${pendingConfirmation.title}"${dueText}?`;
}

function formatContextItemLabel(item: ConversationContextItem, timeZone: string) {
  if (item.type === 'event') {
    return `${item.title} — ${formatEventTime(item.start, item.end, timeZone)}`;
  }

  return `${item.title}${item.due ? ` — due ${formatDateTime(item.due, timeZone)}` : ''}`;
}

function getLatestListContextPayload(successfulListResults: SuccessfulListResult[]) {
  const latestListResult = successfulListResults[successfulListResults.length - 1];

  if (!latestListResult) {
    return {};
  }

  const contextItems = getConversationContextItemsFromListResult(latestListResult);

  return contextItems.length > 0 ? { contextItems } : {};
}

function getConversationContextItemsFromListResult(result: SuccessfulListResult): ConversationContextItem[] {
  if (result.kind === 'events') {
    return result.events
      .filter((event) => event.event_id && event.title)
      .map((event) => ({
        type: 'event',
        id: event.event_id!,
        title: event.title!,
        start: event.start,
        end: event.end,
      }));
  }

  return result.tasks
    .filter((task) => task.task_id && task.title)
    .map((task) => ({
      type: 'task',
      id: task.task_id!,
      title: task.title!,
      due: task.due,
      status: task.status,
    }));
}

function rewriteToolResultMismatchWording(
  reply: string,
  recoverableNotFoundResults: RecoverableNotFoundResult[],
  successfulListResults: SuccessfulListResult[],
  userMessage: string,
  timeZone: string,
  toolCalls: ToolCallTrace[]
) {
  const noMatchReply = rewriteTechnicalNoMatchWording(reply, recoverableNotFoundResults);
  const latestListResult = successfulListResults[successfulListResults.length - 1];

  if (!latestListResult) {
    return noMatchReply;
  }

  const moveFollowUp = formatCalendarMoveFollowUp(latestListResult, userMessage, timeZone, toolCalls);

  if (moveFollowUp) {
    return moveFollowUp;
  }

  if (!isExplicitListRequest(userMessage)) {
    return noMatchReply;
  }

  return formatListResultReply(latestListResult, timeZone);
}

function formatImmediateToolResultReply(
  recoverableNotFoundResults: RecoverableNotFoundResult[],
  successfulListResults: SuccessfulListResult[],
  userMessage: string,
  timeZone: string,
  toolCalls: ToolCallTrace[]
) {
  const latestListResult = successfulListResults[successfulListResults.length - 1];

  if (latestListResult) {
    const moveFollowUp = formatCalendarMoveFollowUp(latestListResult, userMessage, timeZone, toolCalls);

    if (moveFollowUp) {
      return moveFollowUp;
    }

    if (isExplicitListRequest(userMessage)) {
      return formatListResultReply(latestListResult, timeZone);
    }
  }

  const latestNotFoundResult = recoverableNotFoundResults[recoverableNotFoundResults.length - 1];

  if (latestNotFoundResult) {
    return latestNotFoundResult.userMessage;
  }

  return null;
}

function rewriteTechnicalNoMatchWording(reply: string, recoverableNotFoundResults: RecoverableNotFoundResult[]) {
  if (recoverableNotFoundResults.length === 0) {
    return reply;
  }

  const soundsLikeTechnicalFailure =
    /\b(encountered|ran into|hit)\s+(a\s+)?problem\b/i.test(reply) ||
    /\b(something went wrong|technical issue|tool failed|api failed|error)\b/i.test(reply);

  if (!soundsLikeTechnicalFailure) {
    return reply;
  }

  return recoverableNotFoundResults[recoverableNotFoundResults.length - 1].userMessage;
}

function isExplicitListRequest(message: string) {
  if (isCalendarMoveRequest(message) || isMutationRequest(message)) {
    return false;
  }

  return (
    /\b(list|show|display)\b/i.test(message) ||
    /\bwhat(?:'s| is| does)?\b.*\b(calendar|schedule|events?|meetings?|tasks?|todos?)\b/i.test(message) ||
    /\b(calendar|schedule)\b.*\blook like\b/i.test(message)
  );
}

function isMutationRequest(message: string) {
  return /\b(move|reschedule|shift|update|edit|change|delete|remove|cancel|create|add|book|mark|complete)\b/i.test(message);
}

function isCalendarMoveRequest(message: string) {
  return (
    /\b(move|reschedule|shift|change)\b/i.test(message) &&
    /\b(meeting|event|appointment|calendar)\b/i.test(message)
  );
}

function formatCalendarMoveFollowUp(
  result: SuccessfulListResult,
  userMessage: string,
  timeZone: string,
  toolCalls: ToolCallTrace[]
) {
  if (result.kind !== 'events' || !isCalendarMoveRequest(userMessage)) {
    return null;
  }

  if (toolCalls.some((toolCall) => toolCall.name === 'update_event')) {
    return null;
  }

  if (result.events.length === 0) {
    return "I couldn't find a matching calendar event on that day, so I can't move it yet.";
  }

  if (result.events.length > 1) {
    const eventLines = result.events.map((event) => {
      const title = event.title?.trim() || 'Untitled event';
      return `- ${title} — ${formatEventTime(event.start, event.end, timeZone)}`;
    });

    return `I found ${formatCount(result.events.length, 'calendar event')} that could match:\n${eventLines.join('\n')}\n\nWhich one should I move?`;
  }

  if (hasExactTime(userMessage)) {
    return null;
  }

  const event = result.events[0];
  const title = event.title?.trim() || 'Untitled event';
  const destination = extractMoveDestination(userMessage);
  const destinationText = destination ? ` on ${destination}` : '';

  return `I found "${title}" at ${formatEventTime(event.start, event.end, timeZone)}. What exact time${destinationText} should I move it to?`;
}

function hasExactTime(message: string) {
  return /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)\b/i.test(message) || /\b(noon|midnight)\b/i.test(message);
}

function extractMoveDestination(message: string) {
  const match = message.match(/\b(?:to|for)\s+(.+?)\s*[?.!]*$/i);
  return match?.[1]?.trim();
}

function formatListResultReply(result: SuccessfulListResult, timeZone: string) {
  if (result.kind === 'events') {
    if (result.events.length === 0) {
      return "I don't see any calendar events in that range.";
    }

    const eventLines = result.events.map((event) => {
      const title = event.title?.trim() || 'Untitled event';
      return `- ${title} — ${formatEventTime(event.start, event.end, timeZone)}`;
    });

    return `I found ${formatCount(result.events.length, 'calendar event')}:\n${eventLines.join('\n')}`;
  }

  if (result.tasks.length === 0) {
    return "I don't see any matching tasks.";
  }

  const taskLines = result.tasks.map((task) => {
    const title = task.title?.trim() || 'Untitled task';
    const due = task.due ? ` — due ${formatDateTime(task.due, timeZone)}` : '';
    const status = task.status ? ` (${task.status})` : '';
    return `- ${title}${due}${status}`;
  });

  return `I found ${formatCount(result.tasks.length, 'task')}:\n${taskLines.join('\n')}`;
}

function formatCount(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatEventTime(start: string | undefined, end: string | undefined, timeZone: string) {
  if (!start) {
    return 'time not set';
  }

  if (isDateOnly(start)) {
    return `${formatDateOnly(start)} (all day)`;
  }

  const formattedStart = formatDateTime(start, timeZone);

  if (!end) {
    return formattedStart;
  }

  if (isSameLocalDate(start, end, timeZone)) {
    return `${formattedStart}–${formatTimeOnly(end, timeZone)}`;
  }

  return `${formattedStart}–${formatDateTime(end, timeZone)}`;
}

function formatDateTime(value: string, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

function formatTimeOnly(value: string, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

function formatDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSameLocalDate(start: string, end: string, timeZone: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return false;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });

  return formatter.format(startDate) === formatter.format(endDate);
}

function fallbackResult(
  reply: string,
  toolCalls: ToolCallTrace[],
  options: {
    error: string;
    debug: boolean;
    model: string;
    iterations: number;
    steps: DebugStep[];
  }
): AssistantChatResult {
  return {
    reply,
    toolCalls,
    error: options.error,
    ...(options.debug
      ? {
          debug: {
            model: options.model,
            iterations: options.iterations,
            steps: options.steps,
          },
        }
      : {}),
  };
}
