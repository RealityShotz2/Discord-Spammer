import { functionsUrl, supabase } from "./supabase";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Anropar en edge function med användarens session och returnerar JSON eller kastar ett svenskt felmeddelande. */
export async function callFunction<T = Record<string, unknown>>(name: string, body?: unknown, init: { method?: "GET" | "POST"; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" };
  if (init.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/${name}`, {
      method: init.method ?? "POST",
      headers,
      body: init.method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("Kunde inte nå servern. Kontrollera din anslutning.", 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error ?? "Något gick fel. Försök igen.", res.status, json?.code);
  return json as T;
}

/** Översätter Supabase/PostgREST-fel till begripliga svenska meddelanden. */
export function errorMessage(err: unknown): string {
  if (!err) return "Okänt fel";
  if (err instanceof ApiError) return err.message;
  const e = err as { message?: string; code?: string };
  if (e.code === "42501") return e.message && /[åäö]/i.test(e.message) ? e.message : "Du har inte behörighet att göra detta.";
  if (e.code === "23505") return "Det finns redan en post med samma uppgifter.";
  if (e.code === "23514") return "Ett eller flera värden är ogiltiga.";
  if (e.code === "PGRST116") return "Posten hittades inte.";
  const m = e.message ?? String(err);
  const map: Record<string, string> = {
    "Invalid login credentials": "Fel e-postadress eller lösenord.",
    "Email not confirmed": "Bekräfta din e-postadress innan du loggar in. Kolla din inkorg.",
    "User already registered": "Det finns redan ett konto med den e-postadressen.",
    "Password should be at least": "Lösenordet måste vara minst 10 tecken.",
    "For security purposes": "Vänta en stund innan du försöker igen.",
    "Failed to fetch": "Kunde inte nå servern. Kontrollera din anslutning.",
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  if (/Password should contain/i.test(m)) return "Lösenordet måste innehålla stora och små bokstäver samt siffror.";
  return m;
}
