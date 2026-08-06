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
