# CLAUDE.md — Hiagin

Hiagin is a relationship cadence tracker PWA. It tracks people the owner wants to stay in touch with, assigns each a contact cadence (daily → yearly), and surfaces heat-status colors (green / yellow / orange / red) as contacts become overdue. Local-first, sync-optional, mobile-first.

Live at **hiagin.vercel.app**. Owner: Alex Vera (referred to as Alex; he capitalizes Me/My/Myself as a stylistic marker in his own writing — do not "correct" it).

---

## ⛔ HARD RULES — check before every commit

1. **The word "Mom" must NEVER appear anywhere in this project.** Not in code, comments, UX copy, placeholder text, sample data, seed data, test fixtures, commit messages, or bundle output. This is due to the beta tester's personal history and is non-negotiable. Before any deploy, run a word-boundary scan of the built bundle (`grep -rwi "mom" dist/`) and confirm zero hits. Use names like "Sam," "Riley," or "Jordan" for any example contacts.
2. **Never auto-seed demo contacts.** A `makeSeed` function once populated five demo contacts and uploaded them to real user accounts on first sign-in. It was removed entirely. Do not reintroduce seeding in any form. New users start empty.
3. **Never put `authUser` (or any auth-state value) in the auth subscription's `useEffect` dependency array.** This caused an infinite resubscribe loop that hammered Supabase with sync requests. Subscribe once with empty deps; track the previous user via `authUserRef`.
4. **Local-first is the architecture, not a fallback.** The app must be fully functional offline with localStorage only. Supabase sync is a layer on top, never a requirement to use the app.

## Stack — pinned, do not migrate

- React 19 + Vite 7 + Tailwind v4 + Framer Motion + Lucide (icons)
- Flat Vite app (no monorepo — the old api-server/codegen structure was deliberately removed)
- Supabase (East US, project `gtfjeyqjedieqdjdnlqj`): auth + Postgres + Edge Functions
- PWA: self-updating service worker (currently v3), network-first strategy, auto-reload on `controllerchange`
- Storage: localStorage behind an async shim (kept compatible with both standalone deployment and artifact-style storage APIs)

## Deployment

- Pipeline: local build → push contents (not the folder, the *contents*) to repo root at `github.com/ATGPhoenix-ui/hiagin` → Vercel auto-rebuilds in ~60–90s.
- Required Vercel env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (legacy `eyJ…` key format from Supabase Settings → API → Legacy).
- ⚠️ Known gap: both vars are scoped to **Production only**, so Preview deployments silently fall back to ungated offline mode. Either scope vars to Preview too, or treat preview builds as offline-mode only when testing sync.

## Auth & sync model

- Magic-link and password auth; password reset flow via `SetNewPassword`; sign-in gate via `LandingSignIn`.
- Sync: RLS-protected tables, last-write-wins merge. Per-user isolation enforced by RLS — never bypass with service_role from the client.
- Cloud icon in the UI reflects sync state; a "vibrating" cloud icon historically meant the resubscribe loop bug (see Hard Rule 3).

## Push notifications (Chunk 4.5 — SHIPPED 2026-06-10, verified end to end)

- Pushes fire **server-side on breach detection** and land with the app closed. A device with an active push subscription skips the on-open local notification (push *replaces* it); offline/signed-out users keep the on-open check.
- Flow: bell icon → `src/sync/push.js` subscribes via the service worker and upserts endpoint + keys + device tz into `push_subscriptions` (RLS, per-device, unique on user_id+endpoint). Bell off / sign-out unsubscribes the device.
- Server: `supabase/functions/push-overdue` (Edge Function, secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`) invoked hourly by pg_cron job `push-overdue-hourly` (at :05). It sends only to devices at their local `notify_hour` (default 9), dedupes to once/day per device via `last_notified_date`, uses the client's orange/red thresholds, and deletes subscription rows on 404/410.
- Manual test: POST the function with body `{"force": true}` — bypasses hour + dedupe but still requires an orange/red contact.
- Client needs `VITE_VAPID_PUBLIC_KEY` in Vercel (set, Production). If absent, the bell silently falls back to local on-open notifications. The VAPID private key exists ONLY in Supabase secrets; rotating the pair invalidates every subscription.
- Schema/cron source of truth: `supabase-push.sql`. iOS requires the PWA installed to home screen (iOS 16.4+); iOS Web Push has no action buttons — tap-to-open only.
- Follow-ups not yet built: settings UI for notification hour (`notify_hour` column exists, fixed 9am local for now).

## Known outstanding cleanup

- Owner's own Supabase account has stuck demo contacts from the old seeding bug — needs a targeted SQL `DELETE` scoped to his user ID only. Never run unscoped deletes on `public.contacts`. Note (2026-06-10): the account his Android phone signs into had zero contacts before push testing, so the stuck contacts live on a *different* account — confirm which user ID before deleting.

## Product sensibility

- Onboarding leads with "Add my first person" (opens the normal ContactForm); paste-import is a secondary power-user option. Button copy is warm and direct ("Get started"), never bureaucratic ("First-time setup (optional)" was explicitly rejected).
- Focus mode hides green/yellow contacts — the app should feel calm, surfacing only what needs attention.
- Destructive actions get an undo toast (6s), not a confirm dialog.
- Sort options: urgency / name / last contacted / cadence. Collapsible categories with chevrons.
- Interaction log entries are typed (call / text / in-person / email / DM / other with custom label).

## How to work with the owner

- Work in **vertical slices**: each unit of work should end in a deployable, openable state. Deploy previews; he reacts to running software, not diffs.
- Do exactly what was asked, then propose next steps — do not jump ahead (e.g., don't generate keys when asked only whether keys exist).
- When he says "you pick," actually pick and commit to it with reasoning. Don't deflect back.
- Flag mistakes and wrong approaches directly; don't soften.
- Honest tradeoff analysis over cheerleading. Prose over bullet spam in explanations.
- Ask at most one clarifying question, and only when genuinely blocked.

## Before declaring any task done

1. `npm run build` passes clean.
2. `grep -rwi "mom" dist/` returns nothing.
3. App works with localStorage only (sign-out state) — no Supabase dependency for core flows.
4. Service worker version bumped if any cached asset changed.
5. No seeding, no unscoped SQL, no auth-effect dependency regressions.
