import 'server-only';

import { calendar_v3, google } from 'googleapis';
import { getGoogleClient } from '@/src/lib/auth/session';
import {
  EventNotFoundError,
  getGoogleApiMessage,
  getGoogleApiStatus,
  GoogleApiError,
} from './errors';

const PRIMARY_CALENDAR_ID = 'primary';
const DEFAULT_LOOKAHEAD_DAYS = 60;

export interface CalendarEventSummary {
  event_id: string;
  title: string;
  start: string;
  end: string;
  htmlLink?: string;
  attendees?: string[];
  description?: string;
}

export interface CreateEventArgs {
  title: string;
  start_datetime: string;
  end_datetime: string;
  attendees?: string[];
  description?: string;
}

export interface ListEventsArgs {
  start_date: string;
  end_date: string;
}

export interface UpdateEventArgs {
  event_id: string;
  changes: {
    title?: string;
    start_datetime?: string;
    end_datetime?: string;
    attendees?: string[];
    description?: string;
  };
}

export interface DeleteEventArgs {
  event_id: string;
}

export interface FindEventArgs {
  query: string;
  start_date?: string;
  end_date?: string;
}

export async function create_event(args: CreateEventArgs) {
  const calendar = await getCalendarService();
  const requestBody: calendar_v3.Schema$Event = {
    summary: args.title,
    description: args.description,
    start: toEventDateTime(args.start_datetime),
    end: toEventDateTime(args.end_datetime),
    attendees: args.attendees?.map((email) => ({ email })),
  };

  try {
    const { data } = await calendar.events.insert({
      calendarId: PRIMARY_CALENDAR_ID,
      requestBody,
      sendUpdates: args.attendees?.length ? 'all' : 'none',
    });

    return {
      ok: true,
      event: normalizeEvent(data),
    };
  } catch (error) {
    throw toGoogleApiError(error, 'Unable to create calendar event.');
  }
}

export async function list_events(args: ListEventsArgs) {
  const calendar = await getCalendarService();

  try {
    const { data } = await calendar.events.list({
      calendarId: PRIMARY_CALENDAR_ID,
      timeMin: toBoundaryDateTime(args.start_date, 'start'),
      timeMax: toBoundaryDateTime(args.end_date, 'end'),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    return {
      ok: true,
      range: {
        start_date: args.start_date,
        end_date: args.end_date,
      },
      eventCount: data.items?.length ?? 0,
      events: (data.items ?? []).map(normalizeEvent),
      assistantInstruction:
        'If the user asked to list/show calendar events, answer from these events directly. If the array is empty, say there are no events in this range. Do not ask for a meeting title unless the user is trying to update/delete one of multiple possible events.',
    };
  } catch (error) {
    throw toGoogleApiError(error, 'Unable to list calendar events.');
  }
}

export async function update_event(args: UpdateEventArgs) {
  const calendar = await getCalendarService();
  const requestBody: calendar_v3.Schema$Event = {};

  if (args.changes.title !== undefined) {
    requestBody.summary = args.changes.title;
  }

  if (args.changes.description !== undefined) {
    requestBody.description = args.changes.description;
  }

  if (args.changes.start_datetime !== undefined) {
    requestBody.start = toEventDateTime(args.changes.start_datetime);
  }

  if (args.changes.end_datetime !== undefined) {
    requestBody.end = toEventDateTime(args.changes.end_datetime);
  }

  if (args.changes.attendees !== undefined) {
    requestBody.attendees = args.changes.attendees.map((email) => ({ email }));
  }

  try {
    const { data } = await calendar.events.patch({
      calendarId: PRIMARY_CALENDAR_ID,
      eventId: args.event_id,
      requestBody,
      sendUpdates: args.changes.attendees?.length ? 'all' : 'none',
    });

    return {
      ok: true,
      event: normalizeEvent(data),
    };
  } catch (error) {
    if (getGoogleApiStatus(error) === 404) {
      throw new EventNotFoundError(`Calendar event ${args.event_id} was not found.`);
    }

    throw toGoogleApiError(error, 'Unable to update calendar event.');
  }
}

export async function delete_event(args: DeleteEventArgs) {
  const calendar = await getCalendarService();

  try {
    await calendar.events.delete({
      calendarId: PRIMARY_CALENDAR_ID,
      eventId: args.event_id,
      sendUpdates: 'all',
    });

    return {
      ok: true,
      deleted_event_id: args.event_id,
    };
  } catch (error) {
    if (getGoogleApiStatus(error) === 404) {
      throw new EventNotFoundError(`Calendar event ${args.event_id} was not found.`);
    }

    throw toGoogleApiError(error, 'Unable to delete calendar event.');
  }
}

export async function find_event(args: FindEventArgs) {
  const calendar = await getCalendarService();
  const timeMin = args.start_date
    ? toBoundaryDateTime(args.start_date, 'start')
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = args.end_date
    ? toBoundaryDateTime(args.end_date, 'end')
    : new Date(Date.now() + DEFAULT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: searchedData } = await calendar.events.list({
      calendarId: PRIMARY_CALENDAR_ID,
      q: args.query,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 10,
    });
    let matches = (searchedData.items ?? []).map(normalizeEvent);

    if (matches.length === 0) {
      const { data: rangedData } = await calendar.events.list({
        calendarId: PRIMARY_CALENDAR_ID,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      matches = (rangedData.items ?? [])
        .map(normalizeEvent)
        .map((event) => ({
          event,
          score: getEventMatchScore(event, args.query),
        }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((match) => match.event);
    }

    if (matches.length === 0) {
      throw new EventNotFoundError(`No matching calendar event was found for "${args.query}" in the searched date range.`);
    }

    return {
      ok: true,
      event_id: matches[0].event_id,
      event: matches[0],
      alternatives: matches.slice(1, 5),
    };
  } catch (error) {
    if (error instanceof EventNotFoundError) {
      throw error;
    }

    throw toGoogleApiError(error, 'Unable to find calendar event.');
  }
}

async function getCalendarService() {
  const auth = await getGoogleClient();
  return google.calendar({ version: 'v3', auth });
}

function normalizeEvent(event: calendar_v3.Schema$Event): CalendarEventSummary {
  return {
    event_id: event.id ?? '',
    title: event.summary ?? 'Untitled event',
    start: event.start?.dateTime ?? event.start?.date ?? '',
    end: event.end?.dateTime ?? event.end?.date ?? '',
    htmlLink: event.htmlLink ?? undefined,
    attendees: event.attendees?.map((attendee) => attendee.email).filter(Boolean) as string[] | undefined,
    description: event.description ?? undefined,
  };
}

function toEventDateTime(value: string): calendar_v3.Schema$EventDateTime {
  return {
    dateTime: value,
    timeZone: getRuntimeTimeZone(),
  };
}

function toBoundaryDateTime(value: string, boundary: 'start' | 'end') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${boundary === 'start' ? '00:00:00' : '23:59:59'}${getTimeZoneOffsetSuffix(value)}`;
  }

  return value;
}

function getRuntimeTimeZone() {
  return process.env.APP_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

function getTimeZoneOffsetSuffix(value: string) {
  const timeZone = getRuntimeTimeZone();
  const date = new Date(`${value}T12:00:00`);
  const formattedOffset = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  const offset = formattedOffset?.match(/GMT([+-]\d{2}:\d{2})/)?.[1];
  return offset ?? 'Z';
}

function getEventMatchScore(event: CalendarEventSummary, query: string) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const haystack = normalizeSearchText(
    [
      event.title,
      event.description,
      event.attendees?.join(' '),
      getSearchDateTerms(event.start),
    ]
      .filter(Boolean)
      .join(' ')
  );

  if (haystack.includes(normalizedQuery)) {
    return 100 + normalizedQuery.length;
  }

  return normalizedQuery
    .split(/\s+/)
    .filter((part) => part.length > 2 && haystack.includes(part)).length;
}

function getSearchDateTerms(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: getRuntimeTimeZone(),
  }).format(date);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function toGoogleApiError(error: unknown, fallback: string) {
  return new GoogleApiError(getGoogleApiMessage(error, fallback), getGoogleApiStatus(error), {
    cause: error,
  });
}
