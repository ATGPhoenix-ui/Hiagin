# Hiagin — Chunk 4 finishing steps (next session)

The Half A code is done and deployed. The app still works in offline mode
(just like before). To turn on sync, here's the **30-minute setup** for
next session.

## You'll need:

- A web browser (no terminal)
- An email you can check
- Your existing Vercel + GitHub access

## Step 1 — Create Supabase account (~2 min)

1. Go to https://supabase.com → click "Start your project"
2. Sign in with GitHub (the one you used for Vercel — easiest)
3. Click "New Project"
4. Project name: **hiagin**
5. Database password: click "Generate a password" → copy it somewhere safe (you almost never need it)
6. Region: pick the one closest to you (e.g. East US for Massachusetts)
7. Plan: Free
8. Click "Create new project" — wait ~2 min for it to provision

## Step 2 — Set up the database (~2 min)

1. In the project dashboard, click the **SQL Editor** icon in the left sidebar (looks like `>_`)
2. Click "New query"
3. Open the file `supabase-schema.sql` (in this zip)
4. Copy the entire contents and paste into the SQL editor
5. Click "Run" (bottom right)
6. You should see "Success. No rows returned." — that's correct

## Step 3 — Enable email sign-in (~1 min)

Email + magic link is on by default in Supabase. Just verify:

1. Left sidebar → **Authentication** → **Providers**
2. Confirm **Email** is enabled (it is by default)
3. Optional: Configure the email template under "Email Templates" → "Magic Link" — change the sender name to "Hiagin" if you want

## Step 4 — Get your API keys (~1 min)

1. Left sidebar → **Project Settings** (gear icon at the bottom) → **API**
2. You'll see:
   - **Project URL**: `https://xxxxxxxx.supabase.co`
   - **anon / public key**: `eyJ...` (a long string)
3. Copy both somewhere

## Step 5 — Add keys to Vercel (~3 min)

1. Go to your Vercel dashboard → click the **hiagin** project
2. Click **Settings** (top tab) → **Environment Variables**
3. Add two variables:
   - Name: `VITE_SUPABASE_URL` → Value: the URL from step 4
   - Name: `VITE_SUPABASE_ANON_KEY` → Value: the anon key from step 4
4. For each: leave "Environments" set to all three (Production, Preview, Development)
5. Click "Save"

## Step 6 — Redeploy (~2 min)

1. Go to **Deployments** tab in Vercel
2. Click the three dots on the most recent deployment → **Redeploy**
3. Confirm
4. Wait ~60 seconds

## Step 7 — Test it (~3 min)

1. Open `hiagin.vercel.app` in a fresh browser tab (or incognito)
2. You should see a new **cloud icon** in the header (next to the bell)
3. Tap it → "Sign in" dialog opens
4. Enter your email → tap "Send sign-in link"
5. Check your email — there's a link from Supabase. Tap it.
6. The link opens hiagin.vercel.app and signs you in. The cloud icon turns black/filled.
7. Add a test contact. Wait ~2 seconds.
8. Open `hiagin.vercel.app` on your phone. Sign in with the same email there.
9. Watch your phone's app populate with the contact you added on desktop. **That's sync working.**

## Troubleshooting

**"Failed to send sign-in link"** — Email provider rate limit hit, or Supabase email isn't fully provisioned yet. Wait 5 min and retry.

**Magic link emails not arriving** — Check spam. By default Supabase uses their own SMTP and emails sometimes get caught. For production you'd configure your own SMTP, but for personal use it's fine.

**Cloud icon doesn't appear** — env vars not loaded; check Vercel Settings → Environment Variables shows both, then redeploy.

**Sign in works but no sync** — Open browser DevTools → Console. Errors there usually point to RLS policies (re-run the SQL) or wrong project URL/key.

## What this unlocks

Once sync is working, the app:

1. Persists across browser clears, device resets, and reinstalls
2. Syncs between iPhone, Android, desktop browser
3. Justifies App Store submission (no longer "just a webview")
4. Sets up the foundation for scheduled push notifications (next session work) and any future AI features

## What's NOT included yet

These are deliberate Half B decisions, not bugs:

- **No OAuth** (Google/Apple sign-in). Could add later in 30 min.
- **No realtime subscriptions** — sync runs on app open + after each mutation. Real-time push from Supabase to all your devices would be one more session.
- **No offline-only mode toggle** — if you sign in, sync is on. Future: "Use locally only" option.
