-- =====================================================================
-- Sentinel — additive setup for notifications, sharing and escalation.
-- Safe to run on top of the existing schema (all statements are additive).
-- Run in the Supabase SQL editor, then deploy the edge functions:
--   supabase functions deploy escalate-trips notify-contacts
--   supabase secrets set SERVICE_ACCOUNT_JSON PUBLIC_APP_URL
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fcm_tokens — device tokens for push notifications
--    (if the table does not already exist)
-- ---------------------------------------------------------------------
create table if not exists public.fcm_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  token      text not null unique,
  platform   text default 'web',
  created_at timestamptz not null default now()
);

alter table public.fcm_tokens enable row level security;

drop policy if exists fcm_tokens_own_all on public.fcm_tokens;
create policy fcm_tokens_own_all
  on public.fcm_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.fcm_tokens to authenticated;

-- ---------------------------------------------------------------------
-- 2. trusted_contacts.account_id — links a contact to their own Sentinel
--    account (matched by phone at sign-up) so we can push to them.
-- ---------------------------------------------------------------------
alter table public.trusted_contacts
  add column if not exists account_id uuid
  references auth.users (id) on delete set null;

create index if not exists trusted_contacts_account_idx
  on public.trusted_contacts (account_id);

-- Security-definer helper: when a contact signs up with the same phone
-- number they are listed under, link their account so pushes can reach
-- them through their FCM token.
create or replace function public.link_my_contact_account(p_phone text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trusted_contacts
  set account_id = auth.uid()
  where phone = p_phone
    and account_id is null
    and auth.uid() is not null;
$$;

grant execute on function public.link_my_contact_account(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Alerts → webhook. Whenever an alert row is inserted, call the
--    notify-contacts edge function (pg_net is enabled by default).
--    Configure the function URL + service role key per the Supabase
--    pattern for edge functions from database triggers:
--
--    alter role postgres set app.settings.edge_functions_url = 'https://<ref>.supabase.co';
--    alter role postgres set app.settings.service_role_key = '<service_role_key>';
-- ---------------------------------------------------------------------
create or replace function public.notify_alert_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint text;
  bearer   text;
begin
  endpoint := current_setting('app.settings.edge_functions_url', true);
  bearer   := current_setting('app.settings.service_role_key', true);

  if endpoint is null or endpoint = '' or bearer is null or bearer = '' then
    raise notice 'edge_functions_url / service_role_key not configured — skipping notify';
    return new;
  end if;

  perform net.http_post(
    url    := endpoint || '/functions/v1/notify-contacts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || bearer,
      'Content-Type',  'application/json'
    ),
    body   := jsonb_build_object('alert_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_alert on public.alerts;
create trigger trg_notify_alert
  after insert on public.alerts
  for each row execute function public.notify_alert_webhook();

-- ---------------------------------------------------------------------
-- 4. Read-only trip sharing (the "track this trip" link in pushes).
--    SECURITY DEFINER on purpose: anyone holding the trip UUID can read
--    the trail. Treat trip UUIDs as capability tokens; you can revoke by
--    revoking EXECUTE on the two functions.
-- ---------------------------------------------------------------------
create or replace function public.get_public_trip(p_trip_id uuid)
returns setof public.trips
language sql
security definer
set search_path = public
as $$
  select *
  from public.trips
  where id = p_trip_id
    and status in ('active', 'escalated');
$$;

create or replace function public.get_public_trip_locations(p_trip_id uuid)
returns setof public.trip_locations
language sql
security definer
set search_path = public
as $$
  select *
  from public.trip_locations
  where trip_id = p_trip_id
  order by recorded_at asc
  limit 500;
$$;

grant execute on function public.get_public_trip(uuid) to anon, authenticated;
grant execute on function public.get_public_trip_locations(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Escalation scheduler. Runs the escalate-trips edge function every
--    minute; it checks overdue active trips and inserts the tiered
--    nudge → alarm → contact_notify alerts.
-- ---------------------------------------------------------------------
select cron.schedule(
  'sentinel-escalate-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.settings.edge_functions_url', true) || '/functions/v1/escalate-trips',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type',  'application/json'
    ),
    body    := '{}'
  ) as content_id;
  $$
);
