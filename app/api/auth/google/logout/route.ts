import { NextRequest, NextResponse } from 'next/server';
import { getRequestOrigin } from '@/src/lib/auth/redirect';
import { clearSessionCookie } from '@/src/lib/auth/session';

export const runtime = 'nodejs';

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ connected: false });
}

export async function GET(request: NextRequest) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/', getRequestOrigin(request)));
}
