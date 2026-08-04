# Sentinel — Protection that never sleeps

AI-powered street safety for women. A Next.js (App Router) app with Supabase
Auth, real GPS tracking, live location sharing, tiered escalation alerts and
push notifications via Firebase Cloud Messaging.

The visual design is ported 1:1 from the original single-file prototype
(`index.html` in the repo root) — same CSS variables, palette, light/dark
theme and every screen.

## Stack

- **Next.js 14 (App Router)** + Tailwind CSS (design tokens in `tailwind.config.ts`)
- **Supabase**: Auth, Postgres, Realtime, Edge Functions, pg_cron, pg_net
- **Firebase Cloud Messaging**: push notifications (web)
- TypeScript throughout

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your values
npm run dev
```

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run your existing schema (profiles, trusted_contacts, trips,
   trip_locations, alerts + RLS) in the SQL editor.
3. Run [`supabase/notifications_setup.sql`](supabase/notifications_setup.sql) —
   adds `fcm_tokens`, the `trusted_contacts.account_id` link column, the
   alert→webhook trigger, the public track-share functions and the pg_cron
   escalation schedule.
4. Run [`supabase/seed.sql`](supabase/seed.sql) after creating your first
   account (replace `<YOUR_USER_ID>`).
5. Copy the **URL** and **anon key** (Project Settings → API) into `.env.local`.
6. Deploy the edge functions:

   ```bash
   supabase login && supabase link --project-ref <ref>
   supabase functions deploy escalate-trips notify-contacts
   supabase secrets set SERVICE_ACCOUNT_JSON PUBLIC_APP_URL
   ```

7. Wire the trigger secrets (Project → Settings → Database → postgres role):

   ```sql
   alter role postgres set app.settings.edge_functions_url = 'https://<ref>.supabase.co';
   alter role postgres set app.settings.service_role_key = '<service_role_key>';
   ```

### 2. Firebase Cloud Messaging (optional but recommended)

1. Create a Firebase project, add a web app, copy the SDK config into
   `.env.local` (`NEXT_PUBLIC_FIREBASE_*`).
2. Generate a VAPID key (Project settings → Cloud Messaging) →
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
3. Generate a service account (Project settings → Service accounts →
   Generate new private key) → `supabase secrets set SERVICE_ACCOUNT_JSON="$(cat service-account.json)"`.
4. The service worker is served at `/firebase-messaging-sw.js` with env values
   injected at request time — no build step needed.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Home dashboard |
| `/journey/start` | Start Journey (creates a real `trips` row) |
| `/journey/live?trip=<id>` | Live tracking — real GPS |
| `/journey/call` | Fake call |
| `/contacts` | Trusted Contacts |
| `/route` | Safe Route Map (mock heatmap) |
| `/circle` | Safety Circle |
| `/sos` | SOS confirmation (inserts `alerts` row → push) |
| `/settings` | Settings + sign out |
| `/police` | Simulated authority dashboard |
| `/track/<tripId>` | Read-only shared journey view (no login) |
| `/landing` | Public landing (redirect target when signed out) |
| `/login` | Email / phone sign-in & sign-up |

All routes except `/landing`, `/login` and `/track/*` require auth
(`middleware.ts` + `(main)/layout.tsx`).

## How escalation works

1. A trip is created with `expected_arrival_at = started_at + eta + buffer`.
2. Every minute, pg_cron calls the `escalate-trips` edge function.
3. For each overdue **active** trip it fires stages once, in order:

   | Stage | Time past ETA | Floor | Ceiling | Push to |
   | --- | --- | --- | --- | --- |
   | nudge | 25% of ETA | 2 min | 15 min | traveler |
   | alarm | 50% of ETA | 5 min | 30 min | traveler |
   | contact_notify | 75% of ETA | 8 min | 45 min | trusted contacts |

4. Each stage inserts an `alerts` row. The insert trigger calls
   `notify-contacts`, which sends FCM pushes (with a `/track/<tripId>` link)
   and resolves the alert. `contact_notify` also flips the trip to
   `escalated`.
5. The Live screen reflects all of this via Supabase Realtime — no local
   timers.

SOS works the same way: the `/sos` screen inserts an `alerts` row and the
trigger handles the push.

## What is simulated (intentionally)

- **Police dashboard** (`/police`): UI only. A real build needs a formal
  police partnership, jurisdiction-scoped service-role access and an
  ops console.
- **SMS fallback**: the code path exists (`smsFallback` in the edge function,
  toggle in Settings) but is not wired to Twilio or any paid provider.
- **Safe Route heatmap / AI risk**: styled mock overlay; swap in a routing
  API (Google Routes / Mapbox) for real scores.
- **Fake call**: purely a UI deterrent, no real call is placed.

## Project layout

```
app/                 routes (App Router, (main) group = authed screens)
components/          shell (nav/toggles), primitives, toast
lib/                 supabase clients, types, escalation rules, fcm
supabase/            edge functions + setup SQL
middleware.ts        session refresh + route guard
tailwind.config.ts   Sentinel design tokens (light + dark)
```
