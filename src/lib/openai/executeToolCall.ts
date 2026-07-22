import 'server-only';

import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import { AuthConfigurationError, AuthExpiredError, AuthRequiredError } from '@/src/lib/auth/session';
import {
  create_event,
  delete_event,
  find_event,
  list_events,
  update_event,
  type CreateEventArgs,
  type DeleteEventArgs,
  type FindEventArgs,
  type ListEventsArgs,
  type UpdateEventArgs,
} from '@/src/lib/google/calendar';
import { EventNotFoundError, GoogleApiError, TaskNotFoundError } from '@/src/lib/google/errors';
import {
  create_task,
  delete_task,
  find_task,
  list_tasks,
  update_task,
  type CreateTaskArgs,
  type DeleteTaskArgs,
  type FindTaskArgs,
  type ListTasksArgs,
  type UpdateTaskArgs,
} from '@/src/lib/google/tasks';
import {
  list_emails,
  read_email,
  send_email,
  type ListEmailsArgs,
  type ReadEmailArgs,
  type SendEmailArgs,
} from '@/src/lib/google/gmail';
import {
  search_contacts,
  type SearchContactsArgs,
} from '@/src/lib/google/contacts';

type ToolArgs = Record<string, unknown>;

interface ExecuteToolCallOptions {
  allowDestructiveActions?: boolean;
}

const toolExecutors: Record<string, (args: ToolArgs) => Promise<unknown>> = {
  create_event: (args) => create_event(args as unknown as CreateEventArgs),
  list_events: (args) => list_events(args as unknown as ListEventsArgs),
  update_event: (args) => update_event(args as unknown as UpdateEventArgs),
  delete_event: (args) => delete_event(args as unknown as DeleteEventArgs),
  create_task: (args) => create_task(args as unknown as CreateTaskArgs),
  list_tasks: (args) => list_tasks(args as unknown as ListTasksArgs),
  update_task: (args) => update_task(args as unknown as UpdateTaskArgs),
  delete_task: (args) => delete_task(args as unknown as DeleteTaskArgs),
  find_event: (args) => find_event(args as unknown as FindEventArgs),
  find_task: (args) => find_task(args as unknown as FindTaskArgs),
  list_emails: (args) => list_emails(args as unknown as ListEmailsArgs),
  read_email: (args) => read_email(args as unknown as ReadEmailArgs),
  send_email: (args) => send_email(args as unknown as SendEmailArgs),
  search_contacts: (args) => search_contacts(args as unknown as SearchContactsArgs),
};

export async function executeToolCall(
  toolCall: ChatCompletionMessageFunctionToolCall,
  options: ExecuteToolCallOptions = {}
): Promise<ChatCompletionToolMessageParam> {
  const name = toolCall.function.name;
  const parsedArgs = parseToolArguments(toolCall.function.arguments);

  if (!parsedArgs.ok) {
    return buildToolResult(toolCall.id, {
      ok: false,
      errorCode: 'INVALID_TOOL_ARGUMENTS',
      message: parsedArgs.error,
    });
  }

  const executor = toolExecutors[name];

  if (!executor) {
    return buildToolResult(toolCall.id, {
      ok: false,
      errorCode: 'UNKNOWN_TOOL',
      message: `Unknown tool: ${name}`,
    });
  }

  if ((name === 'delete_event' || name === 'delete_task') && !options.allowDestructiveActions) {
    return buildToolResult(toolCall.id, {
      ok: false,
      errorCode: 'DELETE_REQUIRES_CONFIRMATION',
      message: 'Ask the user for explicit confirmation before deleting this item. Do not delete it in this turn.',
    });
  }

  try {
    const result = await executor(parsedArgs.args);
    return buildToolResult(toolCall.id, result);
  } catch (error) {
    if (
      error instanceof AuthExpiredError ||
      error instanceof AuthRequiredError ||
      error instanceof AuthConfigurationError
    ) {
      throw error;
    }

    if (error instanceof EventNotFoundError || error instanceof TaskNotFoundError) {
      return buildToolResult(toolCall.id, buildNotFoundToolResult(error, parsedArgs.args));
    }

    if (error instanceof GoogleApiError) {
      return buildToolResult(toolCall.id, {
        ok: false,
        errorCode: error.code,
        status: error.status,
        message: error.message,
      });
    }

    return buildToolResult(toolCall.id, {
      ok: false,
      errorCode: 'TOOL_EXECUTION_ERROR',
      message: 'The tool failed unexpectedly.',
    });
  }
}

export function getToolCallArgumentsForTrace(rawArguments: string) {
  const parsedArgs = parseToolArguments(rawArguments);
  return parsedArgs.ok ? parsedArgs.args : null;
}

function parseToolArguments(rawArguments: string): { ok: true; args: ToolArgs } | { ok: false; error: string } {
  try {
    const parsed = rawArguments ? JSON.parse(rawArguments) : {};

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Tool arguments must be a JSON object.',
      };
    }

    return {
      ok: true,
      args: parsed as ToolArgs,
    };
  } catch {
    return {
      ok: false,
      error: 'Tool arguments were not valid JSON.',
    };
  }
}

function buildToolResult(toolCallId: string, content: unknown): ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(content),
  };
}

function buildNotFoundToolResult(error: EventNotFoundError | TaskNotFoundError, args: ToolArgs) {
  const isEvent = error instanceof EventNotFoundError;
  const itemLabel = isEvent ? 'calendar event' : 'task';
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const identifier = typeof args.event_id === 'string' ? args.event_id.trim() : typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const matchText = query ? ` matching "${query}"` : identifier ? ` with ID "${identifier}"` : '';
  const retryHint = isEvent ? 'title, date, or time' : 'title, due date, or status';
  const userMessage = `I couldn't find a ${itemLabel}${matchText}, so I can't complete that change yet. If you meant a different ${itemLabel}, send me the ${retryHint} and I'll try again.`;

  return {
    ok: false,
    errorCode: error.code,
    notFound: true,
    recoverable: true,
    message: error.message,
    userMessage,
    assistantInstruction: `This is an empty ${itemLabel} search result, not a system/API failure. Tell the user plainly that no matching ${itemLabel} was found. Do not say "I encountered a problem" or imply Google failed.`,
  };
}
