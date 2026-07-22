import 'server-only';

import { google, tasks_v1 } from 'googleapis';
import { getGoogleClient } from '@/src/lib/auth/session';
import {
  getGoogleApiMessage,
  getGoogleApiStatus,
  GoogleApiError,
  TaskNotFoundError,
} from './errors';

const DEFAULT_TASK_LIST_ID = '@default';

export interface TaskSummary {
  task_id: string;
  title: string;
  notes?: string;
  due?: string;
  status?: string;
  completed?: string;
  updated?: string;
}

export interface CreateTaskArgs {
  title: string;
  due_date?: string;
  notes?: string;
}

export interface ListTasksArgs {
  due_before?: string;
  status?: 'needsAction' | 'completed';
}

export interface UpdateTaskArgs {
  task_id: string;
  changes: {
    title?: string;
    due_date?: string | null;
    notes?: string;
    status?: 'needsAction' | 'completed';
  };
}

export interface DeleteTaskArgs {
  task_id: string;
}

export interface FindTaskArgs {
  query: string;
  status?: 'needsAction' | 'completed';
}

export async function create_task(args: CreateTaskArgs) {
  const tasks = await getTasksService();

  try {
    const { data } = await tasks.tasks.insert({
      tasklist: DEFAULT_TASK_LIST_ID,
      requestBody: {
        title: args.title,
        notes: args.notes,
        due: args.due_date ? toTaskDate(args.due_date) : undefined,
      },
    });

    return {
      ok: true,
      task: normalizeTask(data),
    };
  } catch (error) {
    throw toGoogleApiError(error, 'Unable to create task.');
  }
}

export async function list_tasks(args: ListTasksArgs = {}) {
  const tasks = await getTasksService();

  try {
    const { data } = await tasks.tasks.list({
      tasklist: DEFAULT_TASK_LIST_ID,
      dueMax: args.due_before ? toTaskDate(args.due_before) : undefined,
      showCompleted: args.status !== 'needsAction',
      showDeleted: false,
      showHidden: args.status === 'completed',
      maxResults: 100,
    });
    const normalized = (data.items ?? [])
      .map(normalizeTask)
      .filter((task) => !args.status || task.status === args.status);

    return {
      ok: true,
      taskCount: normalized.length,
      tasks: normalized,
      assistantInstruction:
        'If the user asked to list/show tasks, answer from these tasks directly. If the array is empty, say there are no matching tasks. Do not ask for a task title unless the user is trying to update/delete one of multiple possible tasks.',
    };
  } catch (error) {
    throw toGoogleApiError(error, 'Unable to list tasks.');
  }
}

export async function update_task(args: UpdateTaskArgs) {
  const tasks = await getTasksService();
  const requestBody: tasks_v1.Schema$Task = {};

  if (args.changes.title !== undefined) {
    requestBody.title = args.changes.title;
  }

  if (args.changes.notes !== undefined) {
    requestBody.notes = args.changes.notes;
  }

  if (args.changes.due_date !== undefined) {
    requestBody.due = args.changes.due_date ? toTaskDate(args.changes.due_date) : null;
  }

  if (args.changes.status !== undefined) {
    requestBody.status = args.changes.status;
    requestBody.completed = args.changes.status === 'completed' ? new Date().toISOString() : null;
  }

  try {
    const { data } = await tasks.tasks.patch({
      tasklist: DEFAULT_TASK_LIST_ID,
      task: args.task_id,
      requestBody,
    });

    return {
      ok: true,
      task: normalizeTask(data),
    };
  } catch (error) {
    if (getGoogleApiStatus(error) === 404) {
      throw new TaskNotFoundError(`Task ${args.task_id} was not found.`);
    }

    throw toGoogleApiError(error, 'Unable to update task.');
  }
}

export async function delete_task(args: DeleteTaskArgs) {
  const tasks = await getTasksService();

  try {
    await tasks.tasks.delete({
      tasklist: DEFAULT_TASK_LIST_ID,
      task: args.task_id,
    });

    return {
      ok: true,
      deleted_task_id: args.task_id,
    };
  } catch (error) {
    if (getGoogleApiStatus(error) === 404) {
      throw new TaskNotFoundError(`Task ${args.task_id} was not found.`);
    }

    throw toGoogleApiError(error, 'Unable to delete task.');
  }
}

export async function find_task(args: FindTaskArgs) {
  const { tasks } = await list_tasks({ status: args.status });
  const matches = tasks
    .map((task) => ({
      task,
      score: getTaskMatchScore(task, args.query),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.task);

  if (matches.length === 0) {
    throw new TaskNotFoundError(`No matching task was found for "${args.query}".`);
  }

  return {
    ok: true,
    task_id: matches[0].task_id,
    task: matches[0],
    alternatives: matches.slice(1, 5),
  };
}

async function getTasksService() {
  const auth = await getGoogleClient();
  return google.tasks({ version: 'v1', auth });
}

function normalizeTask(task: tasks_v1.Schema$Task): TaskSummary {
  return {
    task_id: task.id ?? '',
    title: task.title ?? 'Untitled task',
    notes: task.notes ?? undefined,
    due: task.due ?? undefined,
    status: task.status ?? undefined,
    completed: task.completed ?? undefined,
    updated: task.updated ?? undefined,
  };
}

function toTaskDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  return value;
}

function getTaskMatchScore(task: TaskSummary, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const haystack = normalizeSearchText(`${task.title} ${task.notes ?? ''}`);

  if (!normalizedQuery) {
    return 0;
  }

  if (haystack.includes(normalizedQuery)) {
    return 100 + normalizedQuery.length;
  }

  return normalizedQuery
    .split(/\s+/)
    .filter((part) => part.length > 2 && haystack.includes(part)).length;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function toGoogleApiError(error: unknown, fallback: string) {
  return new GoogleApiError(getGoogleApiMessage(error, fallback), getGoogleApiStatus(error), {
    cause: error,
  });
}
