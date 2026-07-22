import 'server-only';

import { google } from 'googleapis';
import { getGoogleClient } from '@/src/lib/auth/session';
import { getGoogleApiMessage, getGoogleApiStatus, GoogleApiError } from './errors';

export interface ContactSummary {
  name: string;
  email: string;
}

export interface SearchContactsArgs {
  query: string;
  max_results?: number;
}

export async function search_contacts(args: SearchContactsArgs): Promise<{
  ok: boolean;
  contacts: ContactSummary[];
  count: number;
}> {
  const auth = await getGoogleClient();
  const people = google.people({ version: 'v1', auth });
  const maxResults = Math.min(args.max_results ?? 10, 20);

  try {
    const response = await people.people.searchContacts({
      query: args.query,
      readMask: 'names,emailAddresses',
      pageSize: maxResults,
    });

    const results = response.data.results ?? [];
    const contacts: ContactSummary[] = [];

    for (const result of results) {
      const person = result.person;
      if (!person) continue;

      const name =
        person.names?.[0]?.displayName ??
        person.names?.[0]?.givenName ??
        '';
      const email = person.emailAddresses?.[0]?.value ?? '';

      if (name || email) {
        contacts.push({ name, email });
      }
    }

    return { ok: true, contacts, count: contacts.length };
  } catch (error) {
    throw new GoogleApiError(
      getGoogleApiMessage(error, 'Failed to search contacts.'),
      getGoogleApiStatus(error)
    );
  }
}
