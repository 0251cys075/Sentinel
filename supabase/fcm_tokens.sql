-- =====================================================================
-- Sentinel — fcm_tokens table (device push-notification tokens).
-- Standalone & idempotent: safe to run in the Supabase SQL editor even
-- if the same table already exists via notifications_setup.sql.
-- =====================================================================

create table if not exists public.fcm_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  token      text not null unique,
  platform   text default 'web',
  created_at timestamptz not null default now()
);

-- Fast lookup: contact user → their device tokens (used by /api/sos-notify).
create index if not exists fcm_tokens_user_idx
  on public.fcm_tokens (user_id);

-- Each user can only manage their own device tokens.
alter table public.fcm_tokens enable row level security;

drop policy if exists fcm_tokens_own_all on public.fcm_tokens;
create policy fcm_tokens_own_all
  on public.fcm_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.fcm_tokens to authenticated;
