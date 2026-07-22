create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_email text unique not null,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz default now()
);

create index if not exists messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at);

create index if not exists conversations_user_id_updated_at_idx
  on conversations (user_id, updated_at desc);

create or replace function update_conversations_updated_at()
returns trigger as $$
begin
  update conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists messages_touch_conversation_updated_at on messages;
create trigger messages_touch_conversation_updated_at
after insert on messages
for each row execute function update_conversations_updated_at();

alter table users enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
