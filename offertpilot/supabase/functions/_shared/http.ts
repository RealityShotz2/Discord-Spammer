// Gemensamma HTTP-hjälpare för edge functions.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const env = { get: (k: string) => Deno.env.get(k) };

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = allowedOrigins.includes("*") ? "*" : allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

/** Wrapper som hanterar CORS, metodkontroll och översätter fel till svenska JSON-svar. */
export function handler(methods: string[], fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (!methods.includes(req.method)) return json(req, { error: "Metoden stöds inte" }, 405);
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json(req, { error: err.message, code: err.code }, err.status);
      const pg = err as { code?: string; message?: string };
      if (pg?.code === "42501") return json(req, { error: pg.message ?? "Behörighet saknas" }, 403);
      if (pg?.code === "P0001" || pg?.code === "22023") return json(req, { error: pg.message }, 400);
      if (pg?.code === "P0002") return json(req, { error: pg.message ?? "Hittades inte" }, 404);
      console.error("unhandled_error", err);
      return json(req, { error: "Ett oväntat fel inträffade. Försök igen." }, 500);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Förfrågan är för stor");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Ogiltig JSON");
  }
}

function supabaseUrl() {
  return Deno.env.get("SUPABASE_URL")!;
}

export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthedContext {
  userId: string;
  email: string | null;
  /** Klient som agerar som användaren – RLS gäller för alla anrop. */
  db: SupabaseClient;
}

export async function requireUser(req: Request): Promise<AuthedContext> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Du måste vara inloggad");
  const db = createClient(supabaseUrl(), Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessionen har gått ut. Logga in igen.");
  return { userId: data.user.id, email: data.user.email ?? null, db };
}

/** Kontrollerar medlemskap och returnerar roll. Läser via användarens klient (RLS). */
export async function requireMembership(ctx: AuthedContext, orgId: string, role?: "admin"): Promise<"admin" | "employee"> {
  const { data } = await ctx.db.from("organization_members").select("role")
    .eq("organization_id", orgId).eq("user_id", ctx.userId).maybeSingle();
  if (!data) throw new HttpError(403, "Behörighet saknas");
  if (role === "admin" && data.role !== "admin") throw new HttpError(403, "Endast administratörer kan utföra detta");
  return data.role;
}

export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const { data, error } = await adminClient().rpc("hit_rate_limit", { rl_key: key, max_hits: max, window_seconds: windowSeconds });
  if (error) {
    console.error("rate_limit_error", error);
    return; // fail-open på intern fel för att inte blockera legitima användare
  }
  if (data === false) throw new HttpError(429, "För många förfrågningar. Vänta en stund och försök igen.");
}

export async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("cf-connecting-ip") ?? "unknown";
  const salt = Deno.env.get("RATE_LIMIT_SALT") ?? "offertpilot";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "http://localhost:5173").replace(/\/$/, "");
}
