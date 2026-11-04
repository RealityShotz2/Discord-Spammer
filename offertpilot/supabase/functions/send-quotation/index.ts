// POST /functions/v1/send-quotation – skickar en GODKÄND offert som PDF via e-post.
// Utan e-postkonfiguration returneras demo: true och ingenting ändras.
import { z } from "zod";
import { adminClient, appUrl, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { loadQuoteBundle } from "../_shared/quote-data.ts";
import { renderQuotePdf } from "../_shared/quote-pdf.ts";
import { emailConfigured, sendEmail, textToHtml } from "../_shared/email.ts";
import { formatSEK } from "../_shared/pricing.ts";
import { ensureConversation } from "../_shared/ai/services.ts";

const Body = z.object({
  quotation_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().max(5000).optional(),
});

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  await rateLimit(`send:user:${user.userId}`, 20, 60);

  const bundle = await loadQuoteBundle(user.db, parsed.data.quotation_id);
  const q = bundle.quote;
  if (!["approved", "sent"].includes(q.status)) throw new HttpError(400, "Offerten måste godkännas innan den kan skickas");
  if (!bundle.customer.email) throw new HttpError(400, "Kunden saknar e-postadress");

  if (!emailConfigured()) {
    return json(req, {
      demo: true,
      message: "E-post är inte konfigurerad (demoläge). Ladda ner PDF:en och skicka den själv, och markera sedan offerten som skickad.",
    });
  }

  const { data: token, error: tokErr } = await user.db.rpc("prepare_quotation_token", { qid: q.id });
  if (tokErr) throw tokErr;
  const link = `${appUrl()}/offert/${token}`;
  const pdf = await renderQuotePdf({ ...bundle, useBranding: bundle.branding });

  const { data: settings } = await user.db.from("organization_settings").select("email_from_name,email_reply_to").eq("organization_id", q.organization_id).single();
  const subject = parsed.data.subject ?? `Offert ${q.number} från ${bundle.org.name}`;
  const text = parsed.data.message ??
    `Hej ${bundle.customer.name.split(" ")[0]}!\n\nTack för din förfrågan. Här kommer vår offert "${q.title}" på totalt ${formatSEK(q.total, { decimals: true })} inkl. moms${q.apply_rot && q.rot_deduction > 0 ? ` (${formatSEK(q.total_to_pay, { decimals: true })} efter preliminärt ROT-avdrag)` : ""}. Offerten finns bifogad som PDF och gäller till ${q.valid_until ?? "angivet datum"}.\n\nDu kan även se offerten och svara direkt via länken nedan.\n\nVänliga hälsningar\n${bundle.org.name}`;

  const result = await sendEmail({
    to: bundle.customer.email,
    subject,
    text: `${text}\n\nSe och besvara offerten: ${link}`,
    html: textToHtml(text, { cta: { label: "Visa och besvara offerten", url: link }, brand: bundle.branding ? bundle.org.brand_color : null }),
    replyTo: settings?.email_reply_to ?? bundle.org.email,
    fromName: settings?.email_from_name ?? bundle.org.name,
    attachments: [{ filename: `Offert-${q.number}.pdf`, content: pdf }],
  });
  if (result.status === "failed") throw new HttpError(502, `E-postutskicket misslyckades: ${result.error}`);

  const { error: markErr } = await user.db.rpc("mark_quotation_sent", { qid: q.id });
  if (markErr) throw markErr;

  if (q.lead_id) {
    const convId = await ensureConversation(user.db, q.organization_id, q.lead_id, "email", subject);
    await adminClient().from("messages").insert({
      organization_id: q.organization_id, conversation_id: convId, lead_id: q.lead_id, direction: "outbound",
      status: "sent", subject, body: text, sent_at: new Date().toISOString(), created_by: user.userId,
    });
  }
  return json(req, { sent: true, link });
}));
