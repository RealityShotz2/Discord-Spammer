// POST /functions/v1/send-message – skickar ett godkänt utkast (meddelande eller uppföljning) till kunden.
// Varje utgående meddelande kräver ett manuellt klick (mänskligt godkännande).
import { z } from "zod";
import { adminClient, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { emailConfigured, sendEmail, textToHtml } from "../_shared/email.ts";
import { ensureConversation } from "../_shared/ai/services.ts";

const Body = z.union([
  z.object({ message_id: z.string().uuid() }),
  z.object({ task_id: z.string().uuid(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000) }),
]);

const OPT_OUT = "\n\n—\nVill du inte få fler meddelanden från oss? Svara med \"STOPP\" så slutar vi höra av oss.";

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  await rateLimit(`send:user:${user.userId}`, 30, 60);
  const admin = adminClient();

  let orgId: string, leadId: string, subject: string, body: string, messageId: string | null = null, taskId: string | null = null;
  if ("message_id" in parsed.data) {
    const { data: m } = await user.db.from("messages").select("id,organization_id,lead_id,direction,status,subject,body").eq("id", parsed.data.message_id).maybeSingle();
    if (!m) throw new HttpError(404, "Meddelandet hittades inte");
    if (m.direction !== "outbound" || m.status !== "draft") throw new HttpError(400, "Endast utkast kan skickas");
    ({ organization_id: orgId, lead_id: leadId, body } = m);
    subject = m.subject ?? "Meddelande";
    messageId = m.id;
  } else {
    const { data: t } = await user.db.from("follow_up_tasks").select("id,organization_id,lead_id,status").eq("id", parsed.data.task_id).maybeSingle();
    if (!t) throw new HttpError(404, "Uppgiften hittades inte");
    if (t.status !== "pending") throw new HttpError(400, "Uppgiften är redan avslutad");
    ({ organization_id: orgId, lead_id: leadId } = t);
    subject = parsed.data.subject;
    body = parsed.data.body;
    taskId = t.id;
  }

  const { data: lead } = await user.db.from("leads").select("customer_id, customers(name,email,opted_out)").eq("id", leadId).single();
  const customer = (Array.isArray(lead?.customers) ? lead?.customers[0] : lead?.customers) as { name: string; email: string | null; opted_out: boolean } | undefined;
  if (!customer?.email) throw new HttpError(400, "Kunden saknar e-postadress");
  if (customer.opted_out) throw new HttpError(403, "Kunden har avböjt fler utskick");

  const { data: org } = await user.db.from("organizations").select("name,email,brand_color").eq("id", orgId).single();
  const { data: settings } = await user.db.from("organization_settings").select("email_from_name,email_reply_to").eq("organization_id", orgId).single();

  let status: "sent" | "demo_not_sent" = "demo_not_sent";
  if (emailConfigured()) {
    const res = await sendEmail({
      to: customer.email, subject, text: body + OPT_OUT, html: textToHtml(body + OPT_OUT),
      replyTo: settings?.email_reply_to ?? org?.email, fromName: settings?.email_from_name ?? org?.name,
    });
    if (res.status === "failed") throw new HttpError(502, `E-postutskicket misslyckades: ${res.error}`);
    status = "sent";
  }

  const now = new Date().toISOString();
  if (messageId) {
    await admin.from("messages").update({ status, sent_at: now }).eq("id", messageId).eq("organization_id", orgId);
  } else {
    const convId = await ensureConversation(user.db, orgId, leadId, "email", subject);
    const { data: m } = await admin.from("messages").insert({
      organization_id: orgId, conversation_id: convId, lead_id: leadId, direction: "outbound", status,
      subject, body, sent_at: now, created_by: user.userId, ai_generated: false,
    }).select("id").single();
    messageId = m?.id ?? null;
    await user.db.from("follow_up_tasks").update({ status: "done", completed_at: now, completed_by: user.userId, draft_subject: subject, draft_body: body }).eq("id", taskId!);
  }
  await user.db.from("leads").update({ last_contact_at: now }).eq("id", leadId);
  // Ett svar till kunden avslutar påminnelsen om obesvarad förfrågan
  await user.db.from("follow_up_tasks").update({ status: "done", completed_at: now, completed_by: user.userId })
    .eq("lead_id", leadId).eq("kind", "lead_response").eq("status", "pending");
  await admin.from("activity_logs").insert({
    organization_id: orgId, actor_id: user.userId, action: status === "sent" ? "message.sent" : "message.demo_not_sent",
    entity_type: "lead", entity_id: leadId, details: { subject },
  });

  return json(req, {
    status, message_id: messageId, demo: status === "demo_not_sent",
    message: status === "sent" ? "Meddelandet har skickats" : "Demoläge: e-post är inte konfigurerad, meddelandet sparades men skickades inte.",
  });
}));
