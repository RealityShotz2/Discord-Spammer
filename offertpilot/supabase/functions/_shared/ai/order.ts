// AI-orderassistent: tolkar en inklistrad kundbeställning, matchar mot företagets prislistor
// och skapar ett ORDERUTKAST. AI sätter aldrig priser och bekräftar aldrig order.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callLlm, type LlmResult } from "./provider.ts";
import { OrderDraftSchema, type OrderDraft } from "./schemas.ts";
import { BASE_RULES, sanitizeUntrusted } from "./context.ts";
import { normalizeCatalog, tierPrice, type CatalogItem } from "../price-lists.ts";

type Env = { get(key: string): string | undefined };
export interface CustomerRef { id: string; name: string; customer_number: number | null; company_name: string | null; email: string | null }

export interface AssembledOrderLine {
  price_list_item_id: string | null;
  sku: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  vat_rate: number;
  sort: number;
}

/** Sätter priser från katalogen. Okända artiklar får inget pris och måste fyllas i manuellt. */
export function assembleOrder(draft: OrderDraft, catalog: CatalogItem[], defaultVat = 25): { lines: AssembledOrderLine[]; warnings: string[] } {
  const byId = new Map(catalog.map((c) => [c.item_id, c]));
  const warnings: string[] = [];
  const lines = draft.items.map((it, i): AssembledOrderLine => {
    const c = it.item_id ? byId.get(it.item_id) : undefined;
    if (it.item_id && !c) warnings.push(`"${it.description}" finns inte i kundens prislista och kräver manuellt pris.`);
    if (!it.item_id) warnings.push(`"${it.description}" kunde inte matchas mot prislistan – kontrollera artikel och pris.`);
    const quantity = Math.round(it.quantity * 1000) / 1000;
    return c
      ? { price_list_item_id: c.item_id, sku: c.sku, description: c.name, quantity, unit: c.unit, unit_price: tierPrice(c, quantity), vat_rate: c.vat_rate, sort: i }
      : { price_list_item_id: null, sku: null, description: it.description, quantity, unit: it.unit, unit_price: null, vat_rate: defaultVat, sort: i };
  });
  for (const m of draft.missing_information) warnings.push(`Saknas: ${m}`);
  return { lines, warnings };
}

/**
 * Artiklar matchade mot standardlistan flyttas till kundens prisbild (kundens egna listor har egna artikel-ID:n).
 * Matchning sker på artikelnummer, annars exakt namn. Det som inte finns hos kunden blir omatchat (inget pris).
 */
export function remapToCatalog(draft: OrderDraft, from: CatalogItem[], to: CatalogItem[]): OrderDraft {
  const src = new Map(from.map((c) => [c.item_id, c]));
  const key = (c: Pick<CatalogItem, "sku" | "name">) => (c.sku ? `sku:${c.sku.toLowerCase()}` : `name:${c.name.toLowerCase()}`);
  const bySku = new Map(to.filter((c) => c.sku).map((c) => [key(c), c]));
  const byName = new Map(to.map((c) => [`name:${c.name.toLowerCase()}`, c]));
  const targetIds = new Set(to.map((c) => c.item_id));
  return {
    ...draft,
    items: draft.items.map((it) => {
      if (!it.item_id || targetIds.has(it.item_id)) return it;
      const s = src.get(it.item_id);
      const hit = s ? (s.sku ? bySku.get(key(s)) : undefined) ?? byName.get(`name:${s.name.toLowerCase()}`) : undefined;
      return { ...it, item_id: hit?.item_id ?? null };
    }),
  };
}

// ----------------------------------------------------------------------------- demoläge
const norm = (s: string) => s.toLowerCase().normalize("NFC");
const stem = (t: string) => t.slice(0, Math.min(t.length, 5));
const words = (s: string) => norm(s).split(/[^a-zåäöé0-9]+/).filter((w) => w.length > 2);

export function demoOrderDraft(text: string, catalog: CatalogItem[], customers: CustomerRef[], fixedCustomer: string | null, today: string): OrderDraft {
  const lower = norm(text);
  const customer = fixedCustomer ?? customers.find((c) => lower.includes(norm(c.name)) || (c.company_name && lower.includes(norm(c.company_name)))
    || (c.email && lower.includes(norm(c.email))))?.id ?? null;
  const textStems = new Set(words(text).map(stem));
  const items: OrderDraft["items"] = [];
  for (const c of catalog) {
    const nameStems = words(c.name).map(stem);
    if (!nameStems.length || !nameStems.some((s) => textStems.has(s))) continue;
    // Mängd: det tal + enhet (t.ex. "500 kg") som står närmast före artikelns namn i texten
    const unit = norm(c.unit).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pos = Math.max(0, ...nameStems.map((s) => lower.search(new RegExp(`\\b${s}`))).filter((p) => p >= 0).slice(0, 1));
    const all = [...lower.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit}\\b`, "g"))];
    const before = all.filter((x) => (x.index ?? 0) <= pos);
    const m = before.length ? before[before.length - 1] : all.find((x) => (x.index ?? 0) > pos) ?? null;
    items.push({ item_id: c.item_id, description: c.name, quantity: m ? Number(m[1].replace(",", ".")) : 1, unit: c.unit,
      reason: m ? `Texten anger ${m[1]} ${c.unit}.` : "Mängd framgår inte – kontrollera." });
  }
  if (!items.length) items.push({ item_id: null, description: sanitizeUntrusted(text, 120) || "Beställning", quantity: 1, unit: "st", reason: "Ingen artikel i prislistan matchade." });
  const missing: string[] = [];
  if (!customer) missing.push("Vilken kund beställningen gäller");
  if (items.some((i) => i.reason.startsWith("Mängd framgår inte"))) missing.push("Mängd för en eller flera artiklar");
  let delivery: string | null = null;
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && iso[1] >= today) delivery = iso[1];
  else if (!/leverans|levereras|datum|måndag|tisdag|onsdag|torsdag|fredag/.test(lower)) missing.push("Önskat leveransdatum");
  const ref = text.match(/(?:ordernr|order nr|referens|ref|po)[:\s#]*([A-Za-z0-9-]{3,30})/i);
  return { customer_id: customer, items, requested_delivery_date: delivery, customer_reference: ref ? ref[1] : null, missing_information: missing };
}

// ----------------------------------------------------------------------------- tjänsten
export interface OrderDraftResult {
  orderId: string | null;
  customerId: string | null;
  needsCustomer: boolean;
  warnings: string[];
  draft: OrderDraft;
  meta: Pick<LlmResult<unknown>, "provider" | "model" | "inputTokens" | "outputTokens" | "latencyMs">;
}

export async function draftOrder(db: SupabaseClient, env: Env, orgId: string, text: string, customerId: string | null): Promise<OrderDraftResult> {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  const { data: customerRows } = await db.from("customers").select("id,name,customer_number,company_name,email")
    .eq("organization_id", orgId).is("anonymized_at", null).neq("status", "ended").order("name").limit(300);
  const customers = (customerRows ?? []) as CustomerRef[];
  if (customerId && !customers.some((c) => c.id === customerId)) throw Object.assign(new Error("Kunden hittades inte"), { code: "P0002" });

  // Prisbild: vald kund, annars företagets standardlista (via en godtycklig kund saknas – använd standardlistans artiklar)
  const loadCatalog = async (cid: string | null): Promise<CatalogItem[]> => {
    if (cid) {
      const { data, error } = await db.rpc("customer_price_catalog", { cust: cid });
      if (error) throw error;
      return normalizeCatalog(data ?? []);
    }
    const { data } = await db.from("price_list_items")
      .select("id,sku,name,description,unit,unit_price,vat_rate,price_lists!inner(is_default,active),price_list_item_tiers(min_quantity,unit_price)")
      .eq("organization_id", orgId).eq("active", true).eq("price_lists.is_default", true).eq("price_lists.active", true).limit(300);
    return normalizeCatalog((data ?? []).map((r: Record<string, unknown>) => ({ ...r, item_id: r.id, tiers: r.price_list_item_tiers })));
  };
  let catalog = await loadCatalog(customerId);

  const catalogBlock = catalog.map((c) => `- ${c.item_id} | ${sanitizeUntrusted(c.sku, 60) || "–"} | ${sanitizeUntrusted(c.name, 200)} | ${c.unit}`).join("\n") || "(inga artiklar)";
  const customerBlock = customerId ? `Kunden är redan vald: ${customerId}` :
    customers.map((c) => `- ${c.id} | ${c.customer_number ?? ""} | ${sanitizeUntrusted(c.name, 160)}${c.company_name ? ` (${sanitizeUntrusted(c.company_name, 160)})` : ""}${c.email ? ` | ${c.email}` : ""}`).join("\n");

  const res = await callLlm(env, {
    schemaName: "order_draft",
    schema: OrderDraftSchema,
    maxTokens: 8000,
    system: `${BASE_RULES}\n\nUppgift: Tolka en beställning som ett företag har fått från sin kund. Matcha kunden mot kundlistan och varje rad mot artiklarna i prislistan (ange exakta ID:n). Ange mängder och leveransdatum endast om de framgår av texten. Dagens datum är ${today} (Europe/Stockholm); relativa datum som "nästa måndag" räknas från det. Ange aldrig priser.`,
    user: `<foretag>\nKunder (id | kundnummer | namn | e-post):\n${customerBlock}\n\nArtiklar i prislistan (id | artikelnummer | namn | enhet):\n${catalogBlock}\n</foretag>\n\n<kunddata>\n${sanitizeUntrusted(text, 6000)}\n</kunddata>`,
  }, () => demoOrderDraft(text, catalog, customers, customerId, today));

  let draft = res.data;
  const chosen = customerId ?? (draft.customer_id && customers.some((c) => c.id === draft.customer_id) ? draft.customer_id : null);
  const meta = res as OrderDraftResult["meta"];
  if (!chosen) return { orderId: null, customerId: null, needsCustomer: true, warnings: ["Välj vilken kund beställningen gäller."], draft, meta };

  if (!customerId) { // kundspecifika priser gäller
    const customerCatalog = await loadCatalog(chosen);
    draft = remapToCatalog(draft, catalog, customerCatalog);
    catalog = customerCatalog;
  }
  const { lines, warnings } = assembleOrder(draft, catalog);
  if (draft.requested_delivery_date && draft.requested_delivery_date < today) {
    warnings.push("Det tolkade leveransdatumet ligger bakåt i tiden och har inte förts in.");
    draft.requested_delivery_date = null;
  }
  const { data: order, error } = await db.from("orders").insert({
    organization_id: orgId, customer_id: chosen, requested_delivery_date: draft.requested_delivery_date,
    customer_reference: draft.customer_reference,
  }).select("id").single();
  if (error || !order) throw error ?? new Error("Kunde inte skapa order");
  const { error: itemsErr } = await db.from("order_items").insert(lines.map((l) => ({ ...l, organization_id: orgId, order_id: order.id })));
  if (itemsErr) {
    await db.from("orders").delete().eq("id", order.id);
    throw itemsErr;
  }
  return { orderId: order.id as string, customerId: chosen, needsCustomer: false, warnings, draft, meta };
}
