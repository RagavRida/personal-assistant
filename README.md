# Personal Assistant

This Next.js app connects a user's Google Calendar and Google Tasks account through real Google OAuth2, routes natural-language chat through OpenAI tool calling, and stores user tokens plus conversation history in Supabase Postgres.

Google OAuth tokens are stored server-side in Postgres. The browser only receives a lightweight signed `httpOnly` session cookie containing the app `userId`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values:

   ```bash
   GOOGLE_CLIENT_ID=""
   GOOGLE_CLIENT_SECRET=""
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
   SESSION_COOKIE_SECRET="use-at-least-32-random-characters-here"
   SUPABASE_URL=""
   SUPABASE_SERVICE_ROLE_KEY=""
   OPENAI_API_KEY=""
   OPENAI_MODEL="gpt-4o"
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

## Supabase Postgres Setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open Project Settings → API.
3. Copy the Project URL into `SUPABASE_URL`.
4. Copy the `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`.
   - Keep this key server-side only. Do not expose it to client components or browser code.
5. Open SQL Editor in Supabase.
6. Paste and run the migration in:

   ```text
   supabase/migrations/001_initial_schema.sql
   ```

The migration creates:

- `users` for Google account email and OAuth tokens
- `conversations` for the user's active conversation
- `messages` for persisted user/assistant messages and tool-call metadata

## Google Cloud Console Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable "Google Calendar API" and "Google Tasks API".
3. Configure OAuth consent screen.
   - Use External.
   - Add your own Google account as a test user so you do not need Google verification for this assignment.
4. Create OAuth 2.0 Client ID.
   - Application type: Web application.
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`.
5. Copy Client ID + Secret into `.env.local`.

## Manual End-to-End Test

1. Visit `http://localhost:3000/api/auth/google`.
2. Complete the Google consent flow.
3. Confirm Google redirects you back to `http://localhost:3000/`.
4. Confirm the status bar shows the Google account as connected and displays your email.
5. Send a message, for example:

   ```text
   What does my calendar look like this week?
   ```

6. Refresh the page.
7. Confirm the conversation rehydrates from `/api/conversations/history` and appears in the chat plus sidebar history.
8. Send another message and confirm it appends to the same persisted conversation.

## Full Manual Test Script

Run these from the main app at `http://localhost:3000` after Supabase, Google OAuth, and OpenAI are configured:

1. `Schedule a meeting with John tomorrow at 3 PM`
2. `Move my Friday meeting to Monday morning`
3. `What does my calendar look like this week?`
4. `Create a task to submit the monthly report next Monday`
5. `Mark my grocery task as completed`
6. `Delete my dentist appointment`
7. `Show me all tasks due this week`
8. Voice input: click the mic, say `Create a task to review demo notes tomorrow`, review the transcript, then send.
9. Ambiguous request: `Schedule lunch with John` and confirm the assistant asks a clarifying question instead of guessing.

For delete requests, the assistant should ask for confirmation first. Send `yes, delete it` only if the identified item is correct.

## Error Handling Notes

- If the Supabase environment variables are missing or the database is unavailable, `/api/chat` returns a clear "assistant temporarily unavailable" message instead of a raw 500.
- If the signed session cookie exists but the user row no longer exists, the app clears the cookie and prompts the user to reconnect Google.
- If Google token refresh fails, the assistant returns `requiresReauth: true` so the UI can show a reconnect button.
