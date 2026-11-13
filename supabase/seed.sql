-- Test data for local stacks and CI only. `supabase start` and `supabase db
-- reset` load it; `supabase db push` never does, so it never reaches the live
-- database. Every name here is made up: this repository is public.
--
-- One owner account. The end-to-end suite signs in as it (e2e/auth.setup.ts).

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'email',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test","email_verified":true}',
  now(), now(), now()
);

insert into portal.members (account_id, role, display_name)
values ('00000000-0000-4000-8000-000000000001', 'owner', 'Test Owner');
