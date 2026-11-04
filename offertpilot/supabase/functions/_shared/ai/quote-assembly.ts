// Sätter ihop ett AI-utkast med företagets katalog. Här garanteras att AI aldrig sätter priser:
// priser, moms och arbetsflagga kommer alltid från katalogen; okända tjänster kräver manuellt pris.
import type { QuoteDraft } from "./schemas.ts";
import type { OrgContext } from "./context.ts";

export interface AssembledItem {
  service_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  vat_rate: number;
  is_labor: boolean;
  source: "ai_catalog" | "ai_manual" | "pricing_rule";
  ai_reason: string | null;
  sort: number;
}

export interface AssembledQuote {
  title: string;
  project_description: string;
  delivery_timeframe: string | null;
  items: AssembledItem[];
  warnings: string[];
}

export function assembleQuote(draft: QuoteDraft, ctx: OrgContext): AssembledQuote {
  const services = new Map(ctx.services.map((s) => [s.id, s]));
  const rules = new Map(ctx.pricingRules.map((r) => [r.id, r]));
  const warnings: string[] = [];
  const items: AssembledItem[] = [];
  const leadTimes = new Set<string>();

  draft.items.forEach((it, idx) => {
    const svc = it.service_id ? services.get(it.service_id) : undefined;
    if (it.service_id && !svc) {
      warnings.push(`AI föreslog en tjänst som inte finns i katalogen ("${it.description}"). Raden kräver manuellt pris.`);
    }
    if (svc) {
      if (svc.default_lead_time) leadTimes.add(svc.default_lead_time);
      if (svc.unit_price === null) warnings.push(`"${svc.name}" saknar pris i katalogen och måste prissättas manuellt.`);
      items.push({
        service_id: svc.id,
        description: it.description || svc.name,
        quantity: it.quantity,
        unit: svc.unit,
        unit_price: svc.unit_price,
        vat_rate: svc.vat_rate,
        is_labor: svc.is_labor,
        source: "ai_catalog",
        ai_reason: it.reason,
        sort: idx + 1,
      });
    } else {
      items.push({
        service_id: null,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: null,
        vat_rate: ctx.settings.default_vat_rate,
        is_labor: false,
        source: "ai_manual",
        ai_reason: it.reason,
        sort: idx + 1,
      });
    }
  });

  let sort = items.length;
  for (const id of new Set(draft.applicable_pricing_rule_ids)) {
    const r = rules.get(id);
    if (!r) continue; // okända regel-ID:n ignoreras
    if (r.kind === "fixed_fee" && r.value !== null) {
      items.push({
        service_id: null, description: r.name, quantity: 1, unit: "st", unit_price: r.value,
        vat_rate: ctx.settings.default_vat_rate, is_labor: false, source: "pricing_rule",
        ai_reason: r.condition ? `Prisregel: ${r.condition}` : "Prisregel", sort: ++sort,
      });
    } else if (r.kind === "discount_percent" || r.kind === "surcharge_percent") {
      warnings.push(`Prisregeln "${r.name}" (${r.value} %) kan vara tillämplig${r.condition ? ` – villkor: ${r.condition}` : ""}. Kontrollera och lägg till manuellt.`);
    } else if (r.kind === "minimum_charge") {
      warnings.push(`Kontrollera minimidebitering enligt "${r.name}" (${r.value} kr).`);
    }
  }

  for (const a of draft.assumptions) warnings.push(`Antagande: ${a}`);
  for (const m of draft.missing_information) warnings.push(`Saknas: ${m}`);
  if (items.some((i) => i.unit_price === null)) warnings.unshift("En eller flera rader saknar pris och måste fyllas i innan offerten kan godkännas.");

  const delivery = leadTimes.size ? [...leadTimes].join(", ") : null;
  if (!delivery) warnings.push("Leveranstid saknas i katalogen – fyll i manuellt.");

  return { title: draft.title, project_description: draft.project_description, delivery_timeframe: delivery, items, warnings };
}
