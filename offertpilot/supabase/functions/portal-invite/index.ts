// POST /functions/v1/portal-invite – bjuder in en kunds kontaktperson till kundportalen.
// Inbjudan sparas med användarens behörighet (RLS); e-post skickas via Resend eller demoläge.
import { z } from "zod";
import { appUrl, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { emailConfigured, sendEmail, textToHtml } from "../_shared/email.ts";

const Body = z.object({
  customer_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  contact_id: z.string().uuid().nullable().optional(),
});

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ange en giltig e-postadress");
  await rateLimit(`portal-invite:${user.userId}`, 30, 3600);
  const { customer_id, email, contact_id } = parsed.data;
  const { data: customer } = await user.db.from("customers").select("id,organization_id,name").eq("id", customer_id).maybeSingle();
  if (!customer) throw new HttpError(404, "Kunden hittades inte");
  const { data: settings } = await user.db.from("organization_settings").select("portal_enabled,email_from_name,email_reply_to").eq("organization_id", customer.organization_id).single();
  if (!settings?.portal_enabled) throw new HttpError(400, "Slå på kundportalen under Inställningar → Order & kundportal först");

  const { data: existing } = await user.db.from("customer_portal_users").select("id,disabled_at").eq("customer_id", customer_id).eq("email", email).maybeSingle();
  if (existing) {
    if (existing.disabled_at) await user.db.from("customer_portal_users").update({ disabled_at: null }).eq("id", existing.id);
  } else {
    const { error } = await user.db.from("customer_portal_users").insert({ organization_id: customer.organization_id, customer_id, email, contact_id: contact_id ?? null });
    if (error) throw error;
  }
  const { data: org } = await user.db.from("organizations").select("name,email,brand_color").eq("id", customer.organization_id).single();
  const link = `${appUrl()}/portal/registrera?email=${encodeURIComponent(email)}`;
  const text = `Hej!\n\n${org?.name ?? "Vi"} har gett er tillgång till kundportalen. Där kan ni se era avtalade priser, följa era beställningar och beställa på nytt.\n\nSkapa ert konto (eller logga in) med den här e-postadressen för att komma åt portalen.`;
  if (!emailConfigured()) return json(req, { invited: true, demo: true, link, message: "Demoläge: e-post är inte konfigurerad. Skicka länken till kunden själv." });
  const res = await sendEmail({
    to: email, subject: `Välkommen till ${org?.name ?? "kundportalen"}`, text: `${text}\n\n${link}`,
    html: textToHtml(text, { cta: { label: "Öppna kundportalen", url: link }, brand: org?.brand_color }),
    replyTo: settings.email_reply_to ?? org?.email, fromName: settings.email_from_name ?? org?.name,
  });
  if (res.status === "failed") throw new HttpError(502, "Inbjudan sparades men e-posten kunde inte skickas");
  return json(req, { invited: true, demo: false });
}));
