// LLM-leverantörer. Nycklar läses endast från miljövariabler på serversidan.
// Stöder Anthropic (Claude), OpenAI och OpenAI-kompatibla API:er. Utan nyckel används demoläge.
import { z } from "zod";

export type ProviderName = "anthropic" | "openai" | "demo";

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
}

export interface LlmResult<T> {
  data: T;
  provider: ProviderName;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export class AiError extends Error {
  constructor(message: string, public readonly code: "timeout" | "invalid_response" | "provider_error" | "not_configured") {
    super(message);
  }
}

type Env = { get(key: string): string | undefined };

export function resolveProvider(env: Env): { name: ProviderName; model: string } {
  const explicit = env.get("AI_PROVIDER")?.toLowerCase();
  const hasAnthropic = !!env.get("ANTHROPIC_API_KEY");
  const hasOpenAi = !!env.get("OPENAI_API_KEY");
  let name: ProviderName = "demo";
  if (explicit === "anthropic" && hasAnthropic) name = "anthropic";
  else if (explicit === "openai" && hasOpenAi) name = "openai";
  else if (!explicit && hasAnthropic) name = "anthropic";
  else if (!explicit && hasOpenAi) name = "openai";
  const defaults: Record<ProviderName, string> = {
    anthropic: "claude-sonnet-5-5",
    openai: "gpt-4.1-mini",
    demo: "demo-heuristik",
  };
  return { name, model: (name !== "demo" && env.get("AI_MODEL")) || defaults[name] };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new AiError("AI-tjänsten svarade inte i tid", "timeout");
    throw new AiError("Kunde inte nå AI-tjänsten", "provider_error");
  } finally {
    clearTimeout(timer);
  }
}

interface RawCall { json: unknown; inputTokens: number | null; outputTokens: number | null }

async function callAnthropic(env: Env, model: string, req: LlmRequest<unknown>, extraUser: string, timeoutMs: number): Promise<RawCall> {
  const inputSchema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete inputSchema.$schema;
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2000,
      system: req.system,
      messages: [{ role: "user", content: req.user + extraUser }],
      tools: [{ name: req.schemaName, description: "Returnera det strukturerade resultatet.", input_schema: inputSchema }],
      tool_choice: { type: "tool", name: req.schemaName },
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error("anthropic_error", res.status, (await res.text()).slice(0, 500));
    throw new AiError(res.status === 429 ? "AI-tjänsten är överbelastad, försök igen om en stund" : "AI-tjänsten returnerade ett fel", "provider_error");
  }
  const body = await res.json();
  const block = (body.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  return { json: block?.input, inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null };
}

async function callOpenAi(env: Env, model: string, req: LlmRequest<unknown>, extraUser: string, timeoutMs: number): Promise<RawCall> {
  const schema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  const base = env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2000,
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema, strict: false } },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user + extraUser },
      ],
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error("openai_error", res.status, (await res.text()).slice(0, 500));
    throw new AiError(res.status === 429 ? "AI-tjänsten är överbelastad, försök igen om en stund" : "AI-tjänsten returnerade ett fel", "provider_error");
  }
  const body = await res.json();
  let json: unknown = undefined;
  try {
    json = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch { /* hanteras av validering */ }
  return { json, inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null };
}

/**
 * Anropar vald leverantör och validerar svaret mot schemat.
 * Vid ogiltigt svar görs ett nytt försök med valideringsfelet som återkoppling.
 */
export async function callLlm<T>(env: Env, req: LlmRequest<T>, demo: () => T): Promise<LlmResult<T>> {
  const { name, model } = resolveProvider(env);
  const started = Date.now();
  if (name === "demo") {
    return { data: req.schema.parse(demo()), provider: "demo", model, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started };
  }
  const timeoutMs = Number(env.get("AI_TIMEOUT_MS") ?? 30000);
  const call = name === "anthropic" ? callAnthropic : callOpenAi;
  let extra = "";
  let inTok = 0;
  let outTok = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call(env, model, req as LlmRequest<unknown>, extra, timeoutMs);
    inTok += raw.inputTokens ?? 0;
    outTok += raw.outputTokens ?? 0;
    const parsed = req.schema.safeParse(raw.json);
    if (parsed.success) {
      return { data: parsed.data, provider: name, model, inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started };
    }
    console.warn("ai_invalid_response", req.schemaName, parsed.error.issues.slice(0, 5));
    extra = `\n\nDitt förra svar var ogiltigt (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}). Returnera ett svar som följer schemat exakt.`;
  }
  throw new AiError("AI-tjänsten returnerade ett ogiltigt svar. Försök igen.", "invalid_response");
}
