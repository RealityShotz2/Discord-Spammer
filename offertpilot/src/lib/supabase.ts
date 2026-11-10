import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// Endast publika värden används här. Hemliga nycklar finns enbart i edge functions.
export const supabase = createClient(url || "http://localhost:54321", key || "public-anon-key-missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export const functionsUrl = `${url ?? ""}/functions/v1`;
