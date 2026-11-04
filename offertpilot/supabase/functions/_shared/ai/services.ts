// Modulära AI-tjänster: klassificering, sammanfattning, kvalificeringsfrågor, offertutkast,
// uppföljningsmeddelanden och nästa säljsteg. Alla läsningar och skrivningar sker med användarens
// klient (RLS), så att AI aldrig kan blanda data mellan organisationer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callLlm, type LlmResult } from "./provider.ts";
import { LeadAnalysisSchema, MessageDraftSchema, QuoteDraftSchema } from "./schemas.ts";
import { BASE_RULES, companyBlock, customerBlock, type LeadContext, type OrgContext } from "./context.ts";
import { demoAnalyzeLead, demoFollowUp, demoQuoteDraft, demoReply } from "./demo.ts";
import { assembleQuote } from "./quote-assembly.ts";

type Env = { get(key: string): string | undefined };

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: "P0001" });
}

export async function loadOrgContext(db: SupabaseClient, orgId: string): Promise<OrgContext> {
  const [org, settings, services, rules, knowledge] = await Promise.all([
    db.from("organizations").select("id,name,industry,description,pricing_model,communication_style,city,email,phone,website").eq("id", orgId).single(),
    db.from("organization_settings").select("ai_tone,ai_custom_instructions,default_vat_rate").eq("organization_id", orgId).single(),
    db.from("services").select("id,name,description,unit,unit_price,vat_rate,is_labor,default_lead_time").eq("organization_id", orgId).eq("active", true).order("sort").limit(200),
    db.from("pricing_rules").select("id,name,kind,value,condition").eq("organization_id", orgId).eq("active", true).limit(50),
    db.from("knowledge_items").select("kind,title,content").eq("organization_id", orgId).eq("active", true).limit(60),
  ]);
  if (org.error || !org.data) fail("Företaget hittades inte");
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    org: org.data,
    settings: { ...settings.data!, default_vat_rate: Number(settings.data?.default_vat_rate ?? 25) },
    services: (services.data ?? []).map((s) => ({ ...s, unit_price: num(s.unit_price), vat_rate: Number(s.vat_rate) })),
    pricingRules: (rules.data ?? []).map((r) => ({ ...r, value: num(r.value) })),
    knowledge: knowledge.data ?? [],
  };
}

export async function loadLeadContext(db: SupabaseClient, leadId: string): Promise<LeadContext & { organization_id: string; stage: string; customer_id: string }> {
  const { data: lead, error } = await db.from("leads")
    .select("id,organization_id,customer_id,stage,title,requested_service,message,source,ai_summary,ai_missing_info,customers(name,city,company_name)")
    .eq("id", leadId).maybeSingle();
  if (error || !lead) throw Object.assign(new Error("Leaden hittades inte"), { code: "P0002" });
  const { data: messages } = await db.from("messages").select("direction,body,created_at")
    .eq("lead_id", leadId).neq("status", "draft").order("created_at").limit(20);
  const customer = (Array.isArray(lead.customers) ? lead.customers[0] : lead.customers) as LeadContext["customer"];
  return {
    organization_id: lead.organization_id,
    customer_id: lead.customer_id,
    stage: lead.stage,
    lead: {
      id: lead.id, title: lead.title, requested_service: lead.requested_service, message: lead.message,
      source: lead.source, ai_summary: lead.ai_summary, ai_missing_info: lead.ai_missing_info as string[] | null,
    },
    customer,
    messages: messages ?? [],
  };
}

export type UsageMeta = Pick<LlmResult<unknown>, "provider" | "model" | "inputTokens" | "outputTokens" | "latencyMs">;

// 1–3 + 6: klassificering, sammanfattning, kvalificeringsfrågor och nästa steg i ett anrop
export async function analyzeLead(db: SupabaseClient, env: Env, leadId: string) {
  const lc = await loadLeadContext(db, leadId);
  const ctx = await loadOrgContext(db, lc.organization_id);
  const res = await callLlm(env, {
    schemaName: "lead_analysis",
    schema: LeadAnalysisSchema,
    maxTokens: 16000,
    system: `${BASE_RULES}\n\nUppgift: Analysera en inkommen kundförfrågan. Klassificera den, sammanfatta, matcha mot företagets tjänster, identifiera vad som saknas för en offert, föreslå följdfrågor och rekommendera nästa steg.`,
    user: `${companyBlock(ctx)}\n\n${customerBlock(lc)}`,
  }, () => demoAnalyzeLead(ctx, lc));

  const known = new Set(ctx.services.map((s) => s.id));
  const a = res.data;
  const update: Record<string, unknown> = {
    ai_summary: a.summary,
    ai_category: a.category,
    ai_priority: a.priority,
    ai_missing_info: a.missing_information,
    ai_questions: a.qualification_questions,
    ai_next_action: a.next_action,
    ai_matched_service_ids: a.matched_service_ids.filter((id) => known.has(id)),
    ai_source: res.provider,
    ai_analyzed_at: new Date().toISOString(),
  };
  if (lc.stage === "new") update.stage = "qualification";
  const { error } = await db.from("leads").update(update).eq("id", leadId);
  if (error) throw error;
  return { organizationId: lc.organization_id, leadId, result: { ...a, is_spam: a.is_spam }, meta: res as UsageMeta };
}

// 4: offertutkast
export async function draftQuotation(db: SupabaseClient, env: Env, leadId: string, extraInstructions?: string) {
  const lc = await loadLeadContext(db, leadId);
  const ctx = await loadOrgContext(db, lc.organization_id);
  const { data: leadRow } = await db.from("leads").select("ai_matched_service_ids").eq("id", leadId).single();
  const preferred = (leadRow?.ai_matched_service_ids as string[] | null) ?? [];

  const res = await callLlm(env, {
    schemaName: "quote_draft",
    schema: QuoteDraftSchema,
    maxTokens: 16000,
    system: `${BASE_RULES}\n\nUppgift: Ta fram ett strukturerat offertutkast. Välj rader ENDAST från företagets tjänstekatalog (ange service_id). Ange mängder bara om de framgår av kunddata – annars mängd 1 och ett antagande. Om ingen tjänst passar, använd service_id null; raden får då manuellt pris. Ange aldrig priser, rabatter eller leveranstider själv – de hämtas från katalogen.`,
    user: `${companyBlock(ctx)}\n\n${customerBlock(lc)}${preferred.length ? `\n\nTidigare matchade tjänster: ${preferred.join(", ")}` : ""}${extraInstructions ? `\n\nInstruktion från företaget (inte från kunden): ${extraInstructions.slice(0, 1000)}` : ""}`,
  }, () => demoQuoteDraft(ctx, lc, preferred));

  const assembled = assembleQuote(res.data, ctx);
  const { data: quote, error } = await db.from("quotations").insert({
    organization_id: lc.organization_id,
    lead_id: leadId,
    customer_id: lc.customer_id,
    title: assembled.title,
    project_description: assembled.project_description,
    delivery_timeframe: assembled.delivery_timeframe,
  }).select("id").single();
  if (error || !quote) throw error ?? new Error("Kunde inte skapa offert");

  const { error: itemsErr } = await db.from("quotation_items").insert(
    assembled.items.map((i) => ({ ...i, organization_id: lc.organization_id, quotation_id: quote.id })),
  );
  if (itemsErr) {
    await db.from("quotations").delete().eq("id", quote.id);
    throw itemsErr;
  }
  // ai_generated och varningar sätts med servernyckel (kolumnerna är inte skrivbara för klienter)
  if (lc.stage !== "quote_draft" && ["new", "qualification"].includes(lc.stage)) {
    await db.from("leads").update({ stage: "quote_draft" }).eq("id", leadId);
  }
  return { organizationId: lc.organization_id, leadId, quotationId: quote.id as string, warnings: assembled.warnings, meta: res as UsageMeta };
}

// 5a: svar med kvalificeringsfrågor
export async function draftReply(db: SupabaseClient, env: Env, leadId: string, instructions?: string) {
  const lc = await loadLeadContext(db, leadId);
  const ctx = await loadOrgContext(db, lc.organization_id);
  const { data: leadRow } = await db.from("leads").select("ai_questions").eq("id", leadId).single();
  const questions = (leadRow?.ai_questions as string[] | null) ?? [];
  const res = await callLlm(env, {
    schemaName: "message_draft",
    schema: MessageDraftSchema,
    maxTokens: 16000,
    system: `${BASE_RULES}\n\nUppgift: Skriv ett svarsmejl till kunden i företagets tonläge. Tacka för förfrågan och ställ de viktigaste följdfrågorna. Lova inga priser eller tider. Avsluta med företagets namn.`,
    user: `${companyBlock(ctx)}\n\n${customerBlock(lc)}\n\nFöreslagna följdfrågor: ${questions.join(" | ") || "inga"}${instructions ? `\n\nInstruktion från företaget: ${instructions.slice(0, 1000)}` : ""}`,
  }, () => demoReply(ctx, lc, questions));

  const conversationId = await ensureConversation(db, lc.organization_id, leadId, "email", res.data.subject);
  const { data: msg, error } = await db.from("messages").insert({
    organization_id: lc.organization_id, conversation_id: conversationId, lead_id: leadId,
    direction: "outbound", status: "draft", subject: res.data.subject, body: res.data.body, ai_generated: true,
  }).select("id").single();
  if (error) throw error;
  return { organizationId: lc.organization_id, leadId, messageId: msg!.id as string, meta: res as UsageMeta };
}

// 5b: uppföljningsmeddelande för en uppgift
export async function draftFollowUp(db: SupabaseClient, env: Env, taskId: string) {
  const { data: task } = await db.from("follow_up_tasks").select("id,lead_id,quotation_id,sequence,kind,status,quotations(number,title,total,sent_at,valid_until)")
    .eq("id", taskId).maybeSingle();
  if (!task) throw Object.assign(new Error("Uppgiften hittades inte"), { code: "P0002" });
  if (task.status !== "pending") fail("Uppgiften är redan avslutad");
  const lc = await loadLeadContext(db, task.lead_id);
  const ctx = await loadOrgContext(db, lc.organization_id);
  const q = (Array.isArray(task.quotations) ? task.quotations[0] : task.quotations) as { number: string; title: string; sent_at: string | null; valid_until: string | null } | null;
  const res = await callLlm(env, {
    schemaName: "message_draft",
    schema: MessageDraftSchema,
    maxTokens: 16000,
    system: `${BASE_RULES}\n\nUppgift: Skriv ett kort, personligt uppföljningsmejl. Var hjälpsam, inte påträngande. Detta är påminnelse nummer ${task.sequence}. Erbjud inga rabatter eller nya villkor.`,
    user: `${companyBlock(ctx)}\n\n${customerBlock(lc)}\n\n${q ? `Offert ${q.number} "${q.title}" skickades ${q.sent_at?.slice(0, 10) ?? "nyligen"} och gäller till ${q.valid_until ?? "okänt datum"}.` : "Kunden har ännu inte fått svar på sin förfrågan."}`,
  }, () => demoFollowUp(ctx, lc, q?.number ?? null, task.sequence));

  const { error } = await db.from("follow_up_tasks").update({
    draft_subject: res.data.subject, draft_body: res.data.body, ai_generated: true,
  }).eq("id", taskId);
  if (error) throw error;
  return { organizationId: lc.organization_id, leadId: task.lead_id as string, taskId, draft: res.data, meta: res as UsageMeta };
}

export async function ensureConversation(db: SupabaseClient, orgId: string, leadId: string, channel: string, subject?: string): Promise<string> {
  const { data: existing } = await db.from("conversations").select("id").eq("lead_id", leadId).eq("channel", channel).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.from("conversations").insert({ organization_id: orgId, lead_id: leadId, channel, subject: subject ?? null })
    .select("id").single();
  if (error) {
    // samtidigt skapad av annan begäran
    const { data: again } = await db.from("conversations").select("id").eq("lead_id", leadId).eq("channel", channel).single();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}
