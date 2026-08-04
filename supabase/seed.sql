-- =====================================================================
-- Sentinel — demo seed data.
-- Run this AFTER creating your first account, then replace the UUIDs
-- with your own user id (SELECT id FROM auth.users LIMIT 1).
-- =====================================================================

insert into public.trusted_contacts (user_id, name, phone, relationship, tier, verified)
values
  ('<YOUR_USER_ID>', 'Aisha Patel',  '+91 90000 10001', 'Family',    'primary',   true),
  ('<YOUR_USER_ID>', 'Priya Sharma', '+91 90000 10002', 'Friend',    'primary',   true),
  ('<YOUR_USER_ID>', 'Riya Kapoor',  '+91 90000 10003', 'Colleague', 'secondary', false)
on conflict do nothing;
