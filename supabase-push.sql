-- Hiagin push notifications schema (Chunk 4.5)
--
-- Paste into Supabase Dashboard → SQL Editor → Run. Safe to run repeatedly.
-- Sets up the per-device push subscription table the push-overdue Edge
-- Function reads from.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  -- IANA timezone of the device at subscribe time; the cron uses it to fire
  -- at the user's local notification hour.
  tz text not null default 'America/New_York',
  notify_hour integer not null default 9 check (notify_hour between 0 and 23),
  -- Dedupe: the local date (in tz) this device was last notified.
  last_notified_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_self_select" on public.push_subscriptions;
create policy "push_subs_self_select" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_subs_self_insert" on public.push_subscriptions;
create policy "push_subs_self_insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_subs_self_update" on public.push_subscriptions;
create policy "push_subs_self_update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_subs_self_delete" on public.push_subscriptions;
create policy "push_subs_self_delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ----- Cron: invoke push-overdue hourly -----
--
-- Runs every hour at :05; the Edge Function itself decides which devices are
-- at their local notification hour and dedupes to once per day per device.
-- Requires the pg_cron and pg_net extensions (Dashboard → Database →
-- Extensions, or the lines below).
--
-- ⚠️ Before running: replace YOUR_ANON_KEY below with the project's anon key
-- (Settings → API → Legacy anon key, the eyJ… one — same value as
-- VITE_SUPABASE_ANON_KEY in Vercel). It's the public client key, safe here.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('push-overdue-hourly')
where exists (select 1 from cron.job where jobname = 'push-overdue-hourly');

select cron.schedule(
  'push-overdue-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://gtfjeyqjedieqdjdnlqj.supabase.co/functions/v1/push-overdue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
