import 'server-only';

import { NextRequest } from 'next/server';

export function getRequestOrigin(request: NextRequest) {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const host = forwardedHost ?? request.headers.get('host');

  if (host) {
    const protocol = forwardedProto ?? getLocalProtocol(host);
    return `${protocol}://${host}`;
  }

  return new URL(process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000').origin;
}

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || undefined;
}

function getLocalProtocol(host: string) {
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
}
