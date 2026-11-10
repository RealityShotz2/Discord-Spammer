// POST /functions/v1/send-order – skickar orderbekräftelse (PDF) till kunden.
// Endast bekräftade order. Utan e-postkonfiguration returneras demo: true och inget skickas.
import { z } from "zod";
import { adminClient, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { loadOrderDoc, orderToPdf } from "../_shared/order-data.ts";
import { renderQuotePdf } from "../_shared/quote-pdf.ts";
import { emailConfigured, sendEmail, textToHtml } from "../_shared/email.ts";
import { formatSEK } from "../_shared/pricing.ts";

const Body = z.object({ order_id: z.string().uuid(), to: z.string().trim().email().max(200).optional(), message: z.string().trim().max(5000).optional() });

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  await rateLimit(`send:user:${user.userId}`, 20, 60);
  const data = await loadOrderDoc(user.db, parsed.data.order_id);
  const o = data.doc.order;
  if (!["confirmed", "in_progress", "delivered"].includes(o.status)) throw new HttpError(400, "Ordern måste bekräftas innan bekräftelsen skickas");
  const to = parsed.data.to ?? data.customerEmail;
  if (!to) throw new HttpError(400, "Kunden saknar e-postadress");
  if (!emailConfigured()) {
    return json(req, { demo: true, message: "E-post är inte konfigurerad (demoläge). Ladda ner PDF:en och skicka den själv." });
  }
  const pdf = await renderQuotePdf(orderToPdf(data.doc, { footer: data.footer, useBranding: data.branding }));
  const { data: settings } = await user.db.from("organization_settings").select("email_from_name,email_reply_to").eq("organization_id", data.organizationId).single();
  const org = data.doc.organization;
  const text = parsed.data.message ??
    `Hej!\n\nTack för er beställning. Här kommer orderbekräftelse ${o.number} på totalt ${formatSEK(Number(o.total), { decimals: true })} inkl. moms${o.requested_delivery_date ? `, med önskad leverans ${o.requested_delivery_date}` : ""}. Bekräftelsen finns bifogad som PDF.\n\nVänliga hälsningar\n${org.name}`;
  const res = await sendEmail({
    to, subject: `Orderbekräftelse ${o.number} från ${org.name}`, text, html: textToHtml(text, { brand: data.branding ? org.brand_color : null }),
    replyTo: settings?.email_reply_to ?? org.email, fromName: settings?.email_from_name ?? org.name,
    attachments: [{ filename: `Orderbekraftelse-${o.number}.pdf`, content: pdf }],
  });
  if (res.status === "failed") throw new HttpError(502, `E-postutskicket misslyckades: ${res.error}`);
  await adminClient().from("activity_logs").insert({
    organization_id: data.organizationId, actor_id: user.userId, action: "order.confirmation_sent", entity_type: "order", entity_id: parsed.data.order_id,
    details: { number: o.number, to },
  });
  return json(req, { sent: true });
}));
