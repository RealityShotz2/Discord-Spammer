// Publik endpoint för webbplatsformuläret (ingen inloggning).
// GET  ?key=<formulärnyckel>  → företagsnamn och tjänster för formuläret
// POST { key, name, email, ... } → skapar kund, lead och meddelande
// Skydd: schemavalidering, honeypot, minsta ifyllnadstid, rate limiting per IP och per formulär.
import { z } from "zod";
import { adminClient, appUrl, handler, hashIp, HttpError, json, rateLimit, readJson } from "../_shared/http.ts";
import { emailConfigured, sendEmail } from "../_shared/email.ts";

const Inquiry = z.object({
  key: z.string().regex(/^[a-f0-9]{24}$/),
  name: z.string().trim().min(2, "Ange ditt namn").max(120),
  email: z.string().trim().toLowerCase().email("Ange en giltig e-postadress").max(200),
  phone: z.string().trim().max(40).regex(/^[0-9+\-\s()]*$/, "Ogiltigt telefonnummer").optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  service: z.string().trim().max(160).optional().or(z.literal("")),
  message: z.string().trim().min(10, "Beskriv gärna ditt ärende med några meningar").max(5000),
  consent: z.literal(true, { message: "Du behöver godkänna att vi behandlar dina uppgifter" }),
  // Anti-spam
  website: z.string().max(0).optional(), // honeypot – ska vara tomt
  started_at: z.number().int(),
});

Deno.serve(handler(["GET", "POST"], async (req) => {
  const admin = adminClient();
  const ip = await hashIp(req);

  if (req.method === "GET") {
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (!/^[a-f0-9]{24}$/.test(key)) throw new HttpError(404, "Formuläret hittades inte");
    await rateLimit(`inquiry:get:${ip}`, 60, 60);
    const { data: org } = await admin.from("organizations").select("id,name,brand_color,website").eq("public_form_key", key).maybeSingle();
    if (!org) throw new HttpError(404, "Formuläret hittades inte");
    const { data: services } = await admin.from("services").select("name").eq("organization_id", org.id).eq("active", true).order("sort").limit(50);
    return json(req, { name: org.name, brand_color: org.brand_color, website: org.website, services: (services ?? []).map((s) => s.name) });
  }

  const raw = await readJson<Record<string, unknown>>(req, 20_000);
  const parsed = Inquiry.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Honeypot: svara som om allt gick bra för att inte avslöja skyddet
    if (first?.path[0] === "website") return json(req, { ok: true });
    throw new HttpError(400, first?.message ?? "Ogiltiga uppgifter");
  }
  const p = parsed.data;
  const elapsed = Date.now() - p.started_at;
  if (elapsed < 3000 || elapsed > 1000 * 60 * 60 * 6) return json(req, { ok: true }); // bot eller utgånget formulär

  await rateLimit(`inquiry:ip:${ip}`, 5, 600);
  await rateLimit(`inquiry:form:${p.key}`, 100, 3600);

  const { data, error } = await admin.rpc("create_public_inquiry", {
    form_key: p.key,
    p: { name: p.name, email: p.email, phone: p.phone ?? "", city: p.city ?? "", service: p.service ?? "", message: p.message },
  });
  if (error) {
    if (error.code === "P0002") throw new HttpError(404, "Formuläret hittades inte");
    throw error;
  }

  // Avisering till företaget (om aktiverat och e-post är konfigurerad)
  if (emailConfigured()) {
    const { data: org } = await admin.from("organizations").select("name,email").eq("id", data.organization_id).single();
    const { data: settings } = await admin.from("organization_settings").select("notifications").eq("organization_id", data.organization_id).single();
    if (org?.email && (settings?.notifications as { new_lead_email?: boolean } | null)?.new_lead_email !== false) {
      await sendEmail({
        to: org.email,
        subject: `Ny förfrågan: ${p.service || "från webbplatsen"}`,
        text: `Du har fått en ny förfrågan från ${p.name} via webbformuläret.\n\nÖppna OffertPilot för att se förfrågan och låta AI analysera den:\n${appUrl()}/app/leads/${data.lead_id}`,
      }).catch((e) => console.error("notify_failed", e));
    }
  }
  return json(req, { ok: true });
}));
