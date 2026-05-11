// Sync engine.
//
// Strategy: last-write-wins per row, identified by stable UUID `id` and
// compared via `updated_at`. Local copy is the source of truth between
// syncs; remote is reconciled on each pull.
//
// Two storage layers:
//   - LocalStorage (existing: cadence:contacts:v1, cadence:interactions:v1)
//   - Supabase tables: contacts, interactions
//
// Sync triggers:
//   - On app load (after auth)
//   - After any local mutation (debounced)
//   - On reconnect (online event)
//   - On Supabase realtime change (when subscribed)

import { getSupabase, isConnectedMode } from "./supabase";

const CONTACTS_KEY = "cadence:contacts:v1";
const INTERACTIONS_KEY = "cadence:interactions:v1";
const LAST_PULL_KEY = "cadence:last-pull:v1";
const PENDING_DELETES_KEY = "cadence:pending-deletes:v1";

// ----- Helpers -----

async function readLocal(key, fallback = []) {
  try {
    const r = await window.storage.get(key);
    if (!r?.value) return fallback;
    const parsed = JSON.parse(r.value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeLocal(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`writeLocal(${key})`, e);
    return false;
  }
}

// Track soft-deletes locally so we can replay them to remote.
async function readPendingDeletes() {
  return readLocal(PENDING_DELETES_KEY, []);
}

async function addPendingDelete(table, id) {
  const all = await readPendingDeletes();
  all.push({ table, id, at: new Date().toISOString() });
  await writeLocal(PENDING_DELETES_KEY, all);
}

async function clearPendingDelete(table, id) {
  const all = await readPendingDeletes();
  const next = all.filter((d) => !(d.table === table && d.id === id));
  await writeLocal(PENDING_DELETES_KEY, next);
}

// ----- Auth -----

export async function getCurrentUser() {
  if (!isConnectedMode) return null;
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

export async function signInWithEmail(email) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Connected mode not configured");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return true;
}

export async function signOut() {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  let unsub = () => {};
  (async () => {
    const supabase = await getSupabase();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user || null, event);
    });
    unsub = () => data.subscription.unsubscribe();
  })();
  return () => unsub();
}

// ----- Sync core -----

/**
 * Pull remote changes into local storage. Last-write-wins per row.
 * Returns { contacts, interactions } merged collections (so the caller
 * can update its React state to match localStorage).
 */
export async function pull() {
  if (!isConnectedMode) return null;
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch everything for this user (in v1, no incremental pull — small
  // datasets, simpler logic. Optimize later with `since` cursor.)
  const [contactsRes, interactionsRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("user_id", user.id),
    supabase.from("interactions").select("*").eq("user_id", user.id),
  ]);
  if (contactsRes.error) throw contactsRes.error;
  if (interactionsRes.error) throw interactionsRes.error;

  const remoteContacts = contactsRes.data || [];
  const remoteInteractions = interactionsRes.data || [];

  // Merge with local
  const localContacts = await readLocal(CONTACTS_KEY);
  const localInteractions = await readLocal(INTERACTIONS_KEY);

  const mergedContacts = mergeByUpdatedAt(localContacts, remoteContacts.map(rowFromRemoteContact));
  const mergedInteractions = mergeByUpdatedAt(localInteractions, remoteInteractions.map(rowFromRemoteInteraction));

  await writeLocal(CONTACTS_KEY, mergedContacts);
  await writeLocal(INTERACTIONS_KEY, mergedInteractions);
  await writeLocal(LAST_PULL_KEY, new Date().toISOString());

  return { contacts: mergedContacts, interactions: mergedInteractions };
}

/**
 * Push local changes (and pending deletes) up to Supabase.
 */
export async function push() {
  if (!isConnectedMode) return;
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const localContacts = await readLocal(CONTACTS_KEY);
  const localInteractions = await readLocal(INTERACTIONS_KEY);
  const pending = await readPendingDeletes();

  // Upsert all local rows. Supabase upsert is idempotent — repeated pushes
  // of unchanged rows are cheap.
  if (localContacts.length > 0) {
    const remoteRows = localContacts.map((c) => rowToRemoteContact(c, user.id));
    const { error } = await supabase.from("contacts").upsert(remoteRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (localInteractions.length > 0) {
    const remoteRows = localInteractions.map((i) => rowToRemoteInteraction(i, user.id));
    const { error } = await supabase.from("interactions").upsert(remoteRows, { onConflict: "id" });
    if (error) throw error;
  }

  // Replay deletes
  for (const d of pending) {
    const { error } = await supabase.from(d.table).delete().eq("id", d.id).eq("user_id", user.id);
    if (!error) await clearPendingDelete(d.table, d.id);
  }
}

export async function syncBoth() {
  await push();
  return pull();
}

// ----- Mutation hooks -----
//
// These wrap localStorage mutations so the rest of the app keeps using
// the same storage shape. Each mutation triggers a debounced push.

let pushTimer = null;
function scheduleDebouncedPush() {
  if (!isConnectedMode) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    push().catch((e) => console.warn("Background push failed:", e));
  }, 1500);
}

export function notifyMutated() {
  scheduleDebouncedPush();
}

export async function notifyDeleted(table, id) {
  if (!isConnectedMode) return;
  await addPendingDelete(table, id);
  scheduleDebouncedPush();
}

// ----- Row mapping -----
//
// Local shape matches what App.jsx already uses. Remote shape is the
// Supabase table shape (snake_case). Translation lives here.

function rowToRemoteContact(c, userId) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    cadence_days: c.cadenceDays,
    last_contacted_date: c.lastContactedDate,
    tags: c.tags || [],
    priority: c.priority,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function rowFromRemoteContact(r) {
  return {
    id: r.id,
    name: r.name,
    cadenceDays: r.cadence_days,
    lastContactedDate: r.last_contacted_date,
    tags: r.tags || [],
    priority: r.priority,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToRemoteInteraction(i, userId) {
  return {
    id: i.id,
    user_id: userId,
    contact_id: i.contactId,
    type: i.type,
    note: i.note || "",
    date: i.date,
    created_at: i.createdAt,
  };
}

function rowFromRemoteInteraction(r) {
  return {
    id: r.id,
    contactId: r.contact_id,
    type: r.type,
    note: r.note || "",
    date: r.date,
    createdAt: r.created_at,
  };
}

function mergeByUpdatedAt(local, remote) {
  const map = new Map();
  // Local first
  for (const item of local) map.set(item.id, item);
  // Remote wins if newer (or local doesn't have it)
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const localTs = existing.updatedAt || existing.createdAt || "";
      const remoteTs = item.updatedAt || item.createdAt || "";
      if (remoteTs > localTs) map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}
