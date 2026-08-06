-- =====================================================================
-- Sentinel — public tokenized SOS tracking for guests.
--
-- Emergency contacts WITHOUT a Sentinel account can follow a loved one's
-- live SOS updates via /sos/track/[sosId]?token=... — no login required.
-- The alert gets a random, cryptographically-strong guest token (32 hex
-- chars) plus a 4-hour expiry. The token doubles as the capability: a
-- wrong/missing/expired token returns nothing (rendered as 403/404 on
-- the page). Resolving the alert or letting it expire invalidates it.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- =====================================================================

-- 1. alerts.guest_token + alerts.guest_token_expires_at — stored with the
--    SOS alert at trigger time by the client (see lib/sos.ts + /sos page).
alter table public.alerts
  add column if not exists guest_token text,
  add column if not exists guest_token_expires_at timestamptz;

-- Enforce one active share per alert: a token is only ever issued once.
alter table public.alerts
  add constraint alerts_guest_token_key unique (guest_token);

create index if not exists alerts_guest_token_idx
  on public.alerts (guest_token);

-- 2. Helper: when an alert is resolved, revoke its guest token so
--    the share link stops working immediately.
create or replace function public.clear_sos_guest_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.guest_token = null;
  new.guest_token_expires_at = null;
  return new;
end;
$$;

-- Auto-revoke the token when a resolved alert is updated.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_sos_clear_guest_token') then
    create trigger trg_sos_clear_guest_token
      after update on public.alerts
      for each row
      when (new.status = 'resolved')
      execute function public.clear_sos_guest_token();
  end if;
exception when undefined_function then
  null;
end $$;

-- 3. One lookup that validates the token AND returns the trip it points at.
--    SECURITY DEFINER on purpose; the token is the capability. Returns an
--    empty set when the token is wrong, expired, the alert is resolved, or
--    the trip is no longer active — the page renders "link has expired".
create or replace function public.get_public_sos_track(p_alert_id uuid, p_token text)
returns setof public.trips
language sql
security definer
set search_path = public
as $$
  select t.*
  from public.alerts a
  join public.trips t on t.id = a.trip_id
  where a.id = p_alert_id
    and a.type = 'sos'
    and a.guest_token is not null
    and a.guest_token = p_token
    and a.guest_token_expires_at > now()
    and a.status <> 'resolved'
    and t.status in ('active', 'escalated')
  limit 1;
$$;

grant execute on function public.get_public_sos_track(uuid, text) to anon, authenticated;