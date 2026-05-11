-- Hiagin database schema for Supabase
--
-- Paste this entire file into Supabase Dashboard → SQL Editor → New query → Run.
-- It's safe to run multiple times; CREATE IF NOT EXISTS / RLS policies are idempotent-ish
-- but to be extra safe, run it on a fresh project.

-- ----- contacts table -----

create table if not exists public.contacts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cadence_days integer not null default 30 check (cadence_days >= 1),
  last_contacted_date date,
  tags text[] not null default '{}',
  priority integer not null default 2 check (priority in (1, 2, 3)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_user_id_idx on public.contacts(user_id);
create index if not exists contacts_updated_at_idx on public.contacts(user_id, updated_at);

-- ----- interactions table -----

create table if not exists public.interactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  type text not null,
  note text not null default '',
  date date not null,
  created_at timestamptz not null default now()
);

create index if not exists interactions_user_id_idx on public.interactions(user_id);
create index if not exists interactions_contact_id_idx on public.interactions(contact_id);

-- ----- Row-level security: each user sees and edits ONLY their own data -----

alter table public.contacts enable row level security;
alter table public.interactions enable row level security;

drop policy if exists "contacts_self_select" on public.contacts;
create policy "contacts_self_select" on public.contacts
  for select using (auth.uid() = user_id);

drop policy if exists "contacts_self_insert" on public.contacts;
create policy "contacts_self_insert" on public.contacts
  for insert with check (auth.uid() = user_id);

drop policy if exists "contacts_self_update" on public.contacts;
create policy "contacts_self_update" on public.contacts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "contacts_self_delete" on public.contacts;
create policy "contacts_self_delete" on public.contacts
  for delete using (auth.uid() = user_id);

drop policy if exists "interactions_self_select" on public.interactions;
create policy "interactions_self_select" on public.interactions
  for select using (auth.uid() = user_id);

drop policy if exists "interactions_self_insert" on public.interactions;
create policy "interactions_self_insert" on public.interactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "interactions_self_update" on public.interactions;
create policy "interactions_self_update" on public.interactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "interactions_self_delete" on public.interactions;
create policy "interactions_self_delete" on public.interactions
  for delete using (auth.uid() = user_id);
