-- =====================================================================
-- Sentinel — live navigation telemetry (speed / heading / travel mode).
--
-- Adds telemetry columns to trip_locations and wires up Supabase
-- Realtime so the no-login guest tracking pages
-- (/track/[tripId], /track/alert/[alertId], /sos/track/[sosId]) receive
-- live position + speed updates over the Realtime channel instead of
-- polling alone.
--
-- Realtime INSERT broadcasts are gated by the subscriber's SELECT policy,
-- so anon guests need a scoped SELECT policy. We scope it to trips that
-- are active/escalated (the same rule the SECURITY DEFINER helpers use),
-- while INSERTs stay restricted to the trip owner.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- =====================================================================

-- 1. Telemetry columns carried on every location insert:
--    speed_kmh  — device GPS speed (m/s * 3.6) or haversine fallback
--    heading    — degrees from true north (0-360)
--    travel_mode — trips.transit_mode at the time of the fix
alter table public.trip_locations
  add column if not exists speed_kmh double precision,
  add column if not exists heading double precision,
  add column if not exists travel_mode text;

-- 2. Fast realtime filter + trail queries on (trip_id, recorded_at).
create index if not exists trip_locations_trip_recorded_idx
  on public.trip_locations (trip_id, recorded_at);

-- 3. RLS: guests (anon) may SELECT locations for trips that are still
--    being shared; owners may SELECT their own trips. INSERTs are
--    owner-scoped only.
alter table public.trip_locations enable row level security;

drop policy if exists trip_locations_public_select on public.trip_locations;
create policy trip_locations_public_select
  on public.trip_locations
  for select
  to anon
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.status in ('active', 'escalated')
    )
  );

drop policy if exists trip_locations_authenticated_select on public.trip_locations;
create policy trip_locations_authenticated_select
  on public.trip_locations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (t.user_id = auth.uid() or t.status in ('active', 'escalated'))
    )
  );

drop policy if exists trip_locations_authenticated_insert on public.trip_locations;
create policy trip_locations_authenticated_insert
  on public.trip_locations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.user_id = auth.uid()
    )
  );

grant select on public.trip_locations to anon;
grant select, insert on public.trip_locations to authenticated;

-- 4. Enable the Realtime publication for trip_locations (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_locations'
  ) then
    alter publication supabase_realtime add table public.trip_locations;
  end if;
end $$;
