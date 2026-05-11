// Supabase client wrapper.
//
// In offline mode, supabase remains null and all sync calls are no-ops.
// When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time,
// connected mode activates.
//
// We lazy-load the supabase-js library so that offline-only deployments
// don't pay the bundle cost.

let supabasePromise = null;

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConnectedMode = Boolean(URL && ANON_KEY);

export async function getSupabase() {
  if (!isConnectedMode) return null;
  if (!supabasePromise) {
    supabasePromise = import("@supabase/supabase-js").then((m) =>
      m.createClient(URL, ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "hiagin-auth",
        },
      })
    );
  }
  return supabasePromise;
}

export const SUPABASE_URL = URL;
export const SUPABASE_ANON_KEY = ANON_KEY;
