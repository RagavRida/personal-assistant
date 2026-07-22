import 'server-only';

import { google } from 'googleapis';
import { getGoogleClient } from '@/src/lib/auth/session';
import { getGoogleApiMessage, getGoogleApiStatus, GoogleApiError } from './errors';

const MAX_RESULTS = 10;

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface EmailDetail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

export interface ListEmailsArgs {
  query?: string;
  max_results?: number;
}

export interface ReadEmailArgs {
  email_id: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
}

export async function list_emails(args: ListEmailsArgs) {
  const auth = await getGoogleClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const maxResults = Math.min(args.max_results ?? 5, MAX_RESULTS);

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: args.query || 'in:inbox',
      maxResults,
    });

    const messageIds = response.data.messages ?? [];

    if (messageIds.length === 0) {
      return { ok: true, emails: [], count: 0 };
    }

    const emails: EmailSummary[] = [];

    for (const msg of messageIds) {
      if (!msg.id) continue;

      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      emails.push({
        id: msg.id,
        threadId: msg.threadId ?? '',
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        snippet: detail.data.snippet ?? '',
        date: getHeader('Date'),
      });
    }

    return { ok: true, emails, count: emails.length };
  } catch (error) {
    throw new GoogleApiError(
      getGoogleApiMessage(error, 'Failed to list emails.'),
      getGoogleApiStatus(error)
    );
  }
}

export async function read_email(args: ReadEmailArgs) {
  const auth = await getGoogleClient();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: args.email_id,
      format: 'full',
    });

    const headers = response.data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    const body = extractEmailBody(response.data.payload);

    return {
      ok: true,
      email: {
        id: response.data.id ?? args.email_id,
        threadId: response.data.threadId ?? '',
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        body,
        date: getHeader('Date'),
      } as EmailDetail,
    };
  } catch (error) {
    throw new GoogleApiError(
      getGoogleApiMessage(error, 'Failed to read email.'),
      getGoogleApiStatus(error)
    );
  }
}

export async function send_email(args: SendEmailArgs) {
  const auth = await getGoogleClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const messageParts = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    args.body,
  ];
  const rawMessage = messageParts.join('\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    return {
      ok: true,
      messageId: response.data.id,
      threadId: response.data.threadId,
    };
  } catch (error) {
    throw new GoogleApiError(
      getGoogleApiMessage(error, 'Failed to send email.'),
      getGoogleApiStatus(error)
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEmailBody(payload: any): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (Array.isArray(payload.parts)) {
    const textPart = payload.parts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (part: any) => part.mimeType === 'text/plain' && part.body?.data
    );

    if (textPart) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }

    const htmlPart = payload.parts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (part: any) => part.mimeType === 'text/html' && part.body?.data
    );

    if (htmlPart) {
      const html = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
      return html.replace(/<[^>]*>/g, '').trim();
    }
  }

  return '';
}
