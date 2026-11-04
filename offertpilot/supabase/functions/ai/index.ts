// POST /functions/v1/ai – kör en AI-tjänst för en lead/uppgift.
// Användarens JWT krävs; all affärsdata läses och skrivs med användarens behörighet (RLS).
import { z } from "zod";
import { adminClient, env, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { AiError } from "../_shared/ai/provider.ts";
import { analyzeLead, draftFollowUp, draftQuotation, draftReply, type UsageMeta } from "../_shared/ai/services.ts";

const Body = z.discriminatedUnion("task", [
  z.object({ task: z.literal("analyze_lead"), lead_id: z.string().uuid() }),
  z.object({ task: z.literal("draft_quotation"), lead_id: z.string().uuid(), instructions: z.string().max(1000).optional() }),
  z.object({ task: z.literal("reply_draft"), lead_id: z.string().uuid(), instructions: z.string().max(1000).optional() }),
  z.object({ task: z.literal("followup_message"), task_id: z.string().uuid() }),
]);

const kindFor = {
  analyze_lead: "ai_lead_analysis",
  draft_quotation: "ai_quote_draft",
  reply_draft: "ai_reply",
  followup_message: "ai_followup",
} as const;

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  const body = parsed.data;
  await rateLimit(`ai:user:${user.userId}`, 30, 60);

  // Hitta organisation och lead via användarens klient (RLS ger 404 för andra organisationer)
  let orgId: string;
  let leadId: string;
  if (body.task === "followup_message") {
    const { data } = await user.db.from("follow_up_tasks").select("organization_id, lead_id").eq("id", body.task_id).maybeSingle();
    if (!data) throw new HttpError(404, "Uppgiften hittades inte");
    orgId = data.organization_id;
    leadId = data.lead_id;
  } else {
    const { data } = await user.db.from("leads").select("organization_id").eq("id", body.lead_id).maybeSingle();
    if (!data) throw new HttpError(404, "Leaden hittades inte");
    orgId = data.organization_id;
    leadId = body.lead_id;
  }

  const admin = adminClient();
  const { data: quota, error: quotaErr } = await admin.rpc("check_ai_quota", {
    org: orgId, lead: leadId, feature: body.task === "followup_message" ? "ai_followups" : null,
  });
  if (quotaErr) throw quotaErr;
  if (!quota?.allowed) throw new HttpError(402, quota?.reason ?? "AI-gränsen är nådd", "quota");

  const record = (meta: { provider: string; model?: string; inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number }, success: boolean, error?: string) =>
    admin.from("usage_records").insert({
      organization_id: orgId, kind: kindFor[body.task], lead_id: leadId, provider: meta.provider, model: meta.model ?? null,
      input_tokens: meta.inputTokens ?? null, output_tokens: meta.outputTokens ?? null, latency_ms: meta.latencyMs ?? null,
      success, error: error?.slice(0, 500) ?? null, created_by: user.userId,
    });

  try {
    let result: Record<string, unknown>;
    let meta: UsageMeta;
    switch (body.task) {
      case "analyze_lead": {
        const r = await analyzeLead(user.db, env, body.lead_id);
        meta = r.meta;
        result = { analysis: r.result };
        break;
      }
      case "draft_quotation": {
        const r = await draftQuotation(user.db, env, body.lead_id, body.instructions);
        meta = r.meta;
        // Markera AI-ursprung och varningar (kolumner som klienter inte får skriva)
        await admin.from("quotations").update({ ai_generated: true, ai_warnings: r.warnings })
          .eq("id", r.quotationId).eq("organization_id", orgId);
        result = { quotation_id: r.quotationId, warnings: r.warnings };
        break;
      }
      case "reply_draft": {
        const r = await draftReply(user.db, env, body.lead_id, body.instructions);
        meta = r.meta;
        result = { message_id: r.messageId };
        break;
      }
      case "followup_message": {
        const r = await draftFollowUp(user.db, env, body.task_id);
        meta = r.meta;
        result = { draft: r.draft };
        break;
      }
    }
    await record(meta, true);
    await admin.from("activity_logs").insert({
      organization_id: orgId, actor_id: user.userId, action: `ai.${body.task}`, entity_type: "lead", entity_id: leadId,
      details: { provider: meta.provider, model: meta.model },
    });
    return json(req, { ...result, provider: meta.provider, demo: meta.provider === "demo" });
  } catch (err) {
    if (err instanceof AiError) {
      await record({ provider: "unknown" }, false, `${err.code}: ${err.message}`);
      throw new HttpError(err.code === "timeout" ? 504 : 502, err.message, err.code);
    }
    throw err;
  }
}));
