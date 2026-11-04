// Läser allt som behövs för att rendera en offert. Används av både klient och edge functions.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfCustomer, PdfItem, PdfOrg, PdfQuote } from "./quote-pdf.ts";

export interface QuoteBundle {
  quote: PdfQuote & { id: string; organization_id: string; lead_id: string | null; customer_id: string; public_token: string | null };
  items: PdfItem[];
  org: PdfOrg;
  customer: PdfCustomer & { opted_out: boolean };
  footer: string | null;
  branding: boolean;
}

const n = (v: unknown) => Number(v ?? 0);

export async function loadQuoteBundle(db: SupabaseClient, quoteId: string): Promise<QuoteBundle> {
  const { data: q, error } = await db.from("quotations").select("*").eq("id", quoteId).maybeSingle();
  if (error || !q) throw Object.assign(new Error("Offerten hittades inte"), { code: "P0002" });
  const [items, org, customer, settings, usage] = await Promise.all([
    db.from("quotation_items").select("*").eq("quotation_id", quoteId).order("sort").order("created_at"),
    db.from("organizations").select("name,org_number,email,phone,website,address,postal_code,city,brand_color").eq("id", q.organization_id).single(),
    db.from("customers").select("name,company_name,email,address,postal_code,city,opted_out").eq("id", q.customer_id).single(),
    db.from("organization_settings").select("quote_footer").eq("organization_id", q.organization_id).single(),
    db.rpc("usage_summary", { org: q.organization_id }),
  ]);
  return {
    quote: {
      ...q,
      discount_value: n(q.discount_value), rot_percent: n(q.rot_percent), subtotal: n(q.subtotal),
      discount_total: n(q.discount_total), vat_total: n(q.vat_total), total: n(q.total),
      rot_deduction: n(q.rot_deduction), total_to_pay: n(q.total_to_pay),
    },
    items: (items.data ?? []).map((i) => ({
      description: i.description, quantity: n(i.quantity), unit: i.unit,
      unit_price: i.unit_price === null ? null : n(i.unit_price), discount_percent: n(i.discount_percent),
      vat_rate: n(i.vat_rate), line_total: n(i.line_total), is_labor: i.is_labor,
    })),
    org: org.data!,
    customer: customer.data!,
    footer: settings.data?.quote_footer ?? null,
    branding: !!(usage.data as { features?: { branding?: boolean } } | null)?.features?.branding,
  };
}
