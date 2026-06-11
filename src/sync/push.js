// Web Push subscription management.
//
// Subscribes this device to server-sent push notifications via the service
// worker, and saves the subscription to Supabase so the push-overdue Edge
// Function can reach this device even when the app is closed.
//
// Falls back gracefully when push is not configured (no VITE_VAPID_PUBLIC_KEY)
// or when the browser doesn't support PushManager.

import { getSupabase, isConnectedMode } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const isPushConfigured = Boolean(VAPID_PUBLIC_KEY && isConnectedMode);

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(userId) {
  if (!isPushConfigured) return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const supabase = await getSupabase();
  if (!supabase) return null;

  let tz = "America/New_York";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      tz,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );

  if (error) {
    console.warn("Failed to save push subscription:", error);
    return null;
  }
  return sub;
}

export async function unsubscribeFromPush(userId) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});

  if (!isConnectedMode || !userId) return;
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
}

// Read this device's daily reminder hour from its subscription row.
// Returns 0-23, or null when this device has no active push subscription.
export async function getDeviceNotifyHour() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const supabase = await getSupabase();
    if (!supabase) return null;
    const { data } = await supabase
      .from("push_subscriptions")
      .select("notify_hour")
      .eq("endpoint", sub.endpoint)
      .maybeSingle();
    return data?.notify_hour ?? null;
  } catch {
    return null;
  }
}

export async function setDeviceNotifyHour(hour) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;
  const supabase = await getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("push_subscriptions")
    .update({ notify_hour: hour, updated_at: new Date().toISOString() })
    .eq("endpoint", sub.endpoint);
  return !error;
}

export async function isSubscribed() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}
