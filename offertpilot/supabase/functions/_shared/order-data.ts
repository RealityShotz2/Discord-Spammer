// Underlag för orderbekräftelse (PDF). Återanvänder offertens PDF-generator med egna rubriker.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfCustomer, PdfDocLabels, PdfItem, PdfOrg, PdfQuote } from "./quote-pdf.ts";

const n = (v: unknown) => Number(v ?? 0);
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("sv-SE") : "–");
export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: "Utkast", pending_approval: "Väntar på godkännande", confirmed: "Bekräftad", in_progress: "Pågår", delivered: "Levererad", cancelled: "Makulerad",
};

export interface OrderDoc {
  order: Record<string, unknown> & { number: string; status: string; created_at: string };
  items: Record<string, unknown>[];
  organization: PdfOrg;
  customer: PdfCustomer;
}

/** Gör om en order till PDF-generatorns format. */
export function orderToPdf(d: OrderDoc, opts: { footer?: string | null; useBranding: boolean }) {
  const o = d.order;
  const quote: PdfQuote = {
    number: o.number, title: `Orderbekräftelse ${o.number}`, created_at: o.created_at, valid_until: null,
    intro: null, project_description: (o.notes_customer as string | null) ?? null,
    delivery_timeframe: [o.delivery_address ? `Leveransadress: ${o.delivery_address}` : null].filter(Boolean).join("\n") || null,
    terms: `Betalningsvillkor: ${n(o.payment_terms_days)} dagar netto.`,
    discount_type: n(o.discount_percent) > 0 ? "percent" : "none", discount_value: n(o.discount_percent), apply_rot: false, rot_percent: 0,
    subtotal: n(o.subtotal), discount_total: n(o.discount_total), vat_total: n(o.vat_total), total: n(o.total), rot_deduction: 0, total_to_pay: n(o.total),
    status: o.status,
  };
  const items: PdfItem[] = d.items.map((i) => ({
    description: String(i.description), quantity: n(i.quantity), unit: String(i.unit), unit_price: i.unit_price === null ? null : n(i.unit_price),
    discount_percent: n(i.discount_percent), vat_rate: n(i.vat_rate), line_total: n(i.line_total), is_labor: false,
  }));
  const meta: [string, string][] = [
    ["Önskad leverans", fmt(o.requested_delivery_date as string | null)],
    ...(o.customer_reference ? [["Er referens", String(o.customer_reference)] as [string, string]] : []),
    ["Status", ORDER_STATUS_LABEL[o.status] ?? o.status],
  ];
  const labels: PdfDocLabels = { title: "ORDERBEKRÄFTELSE", docName: "Orderbekräftelse", numberLabel: "Ordernummer", dateLabel: "Orderdatum", meta, deliveryLabel: "Leverans" };
  return { quote, items, org: d.organization, customer: d.customer, footer: opts.footer ?? null, useBranding: opts.useBranding, labels,
    draftWatermark: ["draft", "pending_approval"].includes(o.status) };
}

/** Läser en order via användarens behörighet (RLS). */
export async function loadOrderDoc(db: SupabaseClient, orderId: string): Promise<{ doc: OrderDoc; footer: string | null; branding: boolean; organizationId: string; customerEmail: string | null; opted_out: boolean }> {
  const { data: o, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !o) throw Object.assign(new Error("Ordern hittades inte"), { code: "P0002" });
  const [items, org, customer, settings, usage, contact] = await Promise.all([
    db.from("order_items").select("*").eq("order_id", orderId).order("sort").order("created_at"),
    db.from("organizations").select("name,org_number,email,phone,website,address,postal_code,city,brand_color").eq("id", o.organization_id).single(),
    db.from("customers").select("name,company_name,email,invoice_email,address,postal_code,city,opted_out").eq("id", o.customer_id).single(),
    db.from("organization_settings").select("quote_footer").eq("organization_id", o.organization_id).single(),
    db.rpc("usage_summary", { org: o.organization_id }),
    o.contact_id ? db.from("customer_contacts").select("email").eq("id", o.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const c = customer.data!;
  return {
    doc: { order: o, items: items.data ?? [], organization: org.data!, customer: { name: c.name, company_name: c.company_name, email: c.email, address: c.address, postal_code: c.postal_code, city: c.city } },
    footer: settings.data?.quote_footer ?? null,
    branding: !!(usage.data as { features?: { branding?: boolean } } | null)?.features?.branding,
    organizationId: o.organization_id,
    customerEmail: (contact.data as { email: string | null } | null)?.email ?? c.email ?? null,
    opted_out: c.opted_out,
  };
}
