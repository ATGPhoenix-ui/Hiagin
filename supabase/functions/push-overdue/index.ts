// push-overdue — sends Web Push notifications to devices whose owner has
// overdue (orange/red) contacts.
//
// Invoked hourly by pg_cron. For each subscribed device:
//   1. Skip unless the device's local hour (in its stored tz) == notify_hour.
//   2. Skip if already notified today (local date, last_notified_date).
//   3. Compute overdue contacts for the owning user (same heat thresholds as
//      the client: ratio >= 1.5 is orange, >= 2 is red, never-contacted = red).
//   4. Send the push; on 404/410 (dead endpoint) delete the subscription row.
//
// Secrets required (supabase secrets set):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Local date parts for a given IANA timezone.
function localParts(tz: string, now: Date) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
    const hour = Number(parts.hour) % 24; // "24" can appear for midnight
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour };
  } catch {
    // Bad/unknown tz on the row — treat as UTC
    const iso = now.toISOString();
    return { date: iso.slice(0, 10), hour: now.getUTCHours() };
  }
}

// Whole days between a YYYY-MM-DD date and a local "today" YYYY-MM-DD.
function daysBetween(fromIso: string, todayIso: string) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

type Contact = {
  name: string;
  cadence_days: number;
  last_contacted_date: string | null;
  priority: number | null;
};

// Mirror of the client's computeHeat + urgencyScore for orange/red detection.
function overdueContacts(contacts: Contact[], todayIso: string) {
  return contacts
    .map((c) => {
      const days = c.last_contacted_date ? daysBetween(c.last_contacted_date, todayIso) : null;
      const ratio = days === null ? Infinity : days / c.cadence_days;
      const urgency = days === null
        ? Infinity
        : (days / c.cadence_days) * (4 - (c.priority ?? 2));
      return { c, ratio, urgency };
    })
    .filter((x) => x.ratio >= 1.5)
    .sort((a, b) => b.urgency - a.urgency);
}

function buildMessage(overdue: ReturnType<typeof overdueContacts>) {
  const top = overdue.slice(0, 3).map((x) => x.c.name).join(", ");
  const more = overdue.length > 3 ? ` and ${overdue.length - 3} more` : "";
  return {
    title: overdue.length === 1
      ? `Reach out to ${overdue[0].c.name}`
      : `${overdue.length} people are overdue`,
    body: overdue.length === 1 ? `It's been a while.` : `${top}${more}`,
    url: "/",
  };
}

Deno.serve(async (req) => {
  // Optional manual-test override: { "force": true } sends regardless of
  // hour/dedupe. Only honored with the service-role key — the anon key is
  // public (ships in the client bundle), so an anon caller must not be able
  // to bypass the once-per-day dedupe and spam devices. The cron sends an
  // empty body and runs the normal gated path.
  let force = false;
  try {
    const body = await req.json();
    if (body?.force === true) {
      const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        force = true;
      } else {
        return Response.json({ error: "force requires service role" }, { status: 403 });
      }
    }
  } catch { /* empty body */ }

  const now = new Date();
  const { data: subs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("*");
  if (subsErr) {
    return Response.json({ error: subsErr.message }, { status: 500 });
  }

  let sent = 0, skipped = 0, pruned = 0, errors = 0;
  const contactsCache = new Map<string, Contact[]>();

  for (const sub of subs ?? []) {
    const { date: localDate, hour: localHour } = localParts(sub.tz, now);

    if (!force) {
      if (localHour !== sub.notify_hour) { skipped++; continue; }
      if (sub.last_notified_date === localDate) { skipped++; continue; }
    }

    let contacts = contactsCache.get(sub.user_id);
    if (!contacts) {
      const { data, error } = await supabase
        .from("contacts")
        .select("name, cadence_days, last_contacted_date, priority")
        .eq("user_id", sub.user_id);
      if (error) { errors++; continue; }
      contacts = data ?? [];
      contactsCache.set(sub.user_id, contacts);
    }

    const overdue = overdueContacts(contacts, localDate);
    if (overdue.length === 0) { skipped++; continue; }

    const payload = JSON.stringify(buildMessage(overdue));
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
      await supabase
        .from("push_subscriptions")
        .update({ last_notified_date: localDate })
        .eq("id", sub.id);
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // Endpoint is gone (user revoked / browser dropped it) — prune.
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        pruned++;
      } else {
        console.error("push failed", sub.id, e);
        errors++;
      }
    }
  }

  return Response.json({ sent, skipped, pruned, errors, total: subs?.length ?? 0 });
});
