-- =====================================================================
-- Sentinel — real SOS notifications: WhatsApp + email fallback + contact
-- verification. Additive and idempotent. Run in the Supabase SQL editor.
-- =====================================================================

-- 1. trusted_contacts.email — fallback channel for contacts without WhatsApp.
alter table public.trusted_contacts
  add column if not exists email text;

-- 2. trusted_contacts.pending_verification_code — 6-digit code stored when
--    the contact is added; cleared when they verify via /api/verify-code.
alter table public.trusted_contacts
  add column if not exists pending_verification_code text;

-- 3. Alert-link resolution: a /track/<recordId> page can be opened from an
--    FCM notification whose data only carries alertId (not tripId). This
--    resolves an sos alert back to its trip so the public track functions
--    can render the user's last known location.
--    SECURITY DEFINER on purpose — the alert id acts as a capability token,
--    matching the existing get_public_trip() pattern.
create or replace function public.get_public_trip_by_alert(p_alert_id uuid)
returns setof public.trips
language sql
security definer
set search_path = public
as $$
  select t.*
  from public.trips t
  join public.alerts a on a.trip_id = t.id
  where a.id = p_alert_id
    and t.status in ('active', 'escalated')
  limit 1;
$$;

grant execute on function public.get_public_trip_by_alert(uuid) to anon, authenticated;
