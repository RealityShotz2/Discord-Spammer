import { describe, expect, it } from "vitest";
import { describeSchedule, matches, nextOccurrence, upcoming, type ScheduleRule } from "@shared/schedule.ts";
import { normalizeCatalog, tierPrice, type CatalogItem } from "@shared/price-lists.ts";
import { assembleOrder, demoOrderDraft, remapToCatalog } from "@shared/ai/order.ts";
import { OrderDraftSchema } from "@shared/ai/schemas.ts";
import { orderToPdf } from "@shared/order-data.ts";
import { renderQuotePdf } from "@shared/quote-pdf.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const catalog: CatalogItem[] = [
  { item_id: ID(1), sku: "RAK-1", name: "Räkor kokta", description: null, unit: "kg", unit_price: 189, vat_rate: 12, tiers: [{ min_quantity: 100, unit_price: 179 }, { min_quantity: 500, unit_price: 169 }] },
  { item_id: ID(2), sku: "LAX-1", name: "Laxfilé", description: null, unit: "kg", unit_price: 245.5, vat_rate: 12, tiers: [] },
  { item_id: ID(3), sku: "PALL", name: "Pallhyra", description: null, unit: "pall", unit_price: 95, vat_rate: 25, tiers: [] },
];

describe("återkommande schema", () => {
  const weekly: ScheduleRule = { frequency: "weekly", interval: 1, weekdays: [1], startDate: "2026-11-02" };
  it("varje måndag", () => {
    expect(upcoming(weekly, "2026-11-10", 3)).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(describeSchedule(weekly)).toBe("Varje måndag");
  });
  it("varannan vecka på flera dagar", () => {
    const r: ScheduleRule = { frequency: "weekly", interval: 2, weekdays: [2, 4], startDate: "2026-11-02" };
    expect(upcoming(r, "2026-11-02", 4)).toEqual(["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19"]);
    expect(describeSchedule(r)).toBe("Varannan vecka, tisdag och torsdag");
  });
  it("månadsslut klampas till sista dagen", () => {
    const r: ScheduleRule = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-01-31" };
    expect(upcoming(r, "2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(upcoming({ ...r, startDate: "2028-01-31" }, "2028-02-01", 1)).toEqual(["2028-02-29"]); // skottår
  });
  it("sommartid påverkar inte datum", () => {
    const r: ScheduleRule = { frequency: "daily", interval: 1, startDate: "2026-03-28" };
    expect(upcoming(r, "2026-03-28", 3)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(upcoming({ ...r, startDate: "2026-10-24" }, "2026-10-24", 3)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
  it("slutdatum och start i framtiden respekteras", () => {
    expect(nextOccurrence({ ...weekly, endDate: "2026-11-20" }, "2026-11-21")).toBeNull();
    expect(nextOccurrence({ ...weekly, startDate: "2027-01-04" }, "2026-11-10")).toBe("2027-01-04");
    expect(matches(weekly, new Date("2026-10-26T00:00:00Z"))).toBe(false); // före start
  });
  it("var tredje dag", () => {
    expect(upcoming({ frequency: "daily", interval: 3, startDate: "2026-11-01" }, "2026-11-02", 2)).toEqual(["2026-11-04", "2026-11-07"]);
  });
});

describe("prislistor", () => {
  it("mängdrabatt väljer högsta uppnådda steg", () => {
    expect(tierPrice(catalog[0], 50)).toBe(189);
    expect(tierPrice(catalog[0], 100)).toBe(179);
    expect(tierPrice(catalog[0], 499.999)).toBe(179);
    expect(tierPrice(catalog[0], 500)).toBe(169);
    expect(tierPrice(catalog[1], 1000)).toBe(245.5);
  });
  it("normaliserar numeric-strängar från databasen", () => {
    const [c] = normalizeCatalog([{ item_id: ID(9), sku: null, name: "X", description: null, unit: "st", unit_price: "12.50", vat_rate: "25.00", tiers: [{ min_quantity: "10.000", unit_price: "11.00" }] }]);
    expect(c.unit_price).toBe(12.5);
    expect(tierPrice(c, 10)).toBe(11);
  });
});

describe("AI-orderassistent", () => {
  it("priser kommer alltid från prislistan, aldrig från AI", () => {
    const draft = OrderDraftSchema.parse({
      customer_id: ID(50), requested_delivery_date: null, customer_reference: null, missing_information: [],
      items: [
        { item_id: ID(1), description: "räkor", quantity: 500, unit: "kg", reason: "x" },
        { item_id: ID(99), description: "Hummer", quantity: 2, unit: "st", reason: "x" }, // finns inte i kundens lista
        { item_id: null, description: "Kaviar", quantity: 1, unit: "st", reason: "x" },
      ],
    });
    const { lines, warnings } = assembleOrder(draft, catalog);
    expect(lines[0]).toMatchObject({ price_list_item_id: ID(1), unit_price: 169, unit: "kg", vat_rate: 12, description: "Räkor kokta" });
    expect(lines[1]).toMatchObject({ price_list_item_id: null, unit_price: null });
    expect(lines[2]).toMatchObject({ price_list_item_id: null, unit_price: null });
    expect(warnings).toHaveLength(2);
  });
  it("schemat avvisar priser och ogiltiga mängder", () => {
    const base = { customer_id: null, requested_delivery_date: null, customer_reference: null, missing_information: [] };
    expect(OrderDraftSchema.safeParse({ ...base, items: [{ item_id: null, description: "x", quantity: -1, unit: "st", reason: "x" }] }).success).toBe(false);
    const parsed = OrderDraftSchema.parse({ ...base, items: [{ item_id: null, description: "x", quantity: 1, unit: "st", reason: "x", unit_price: 1 }] });
    expect("unit_price" in parsed.items[0]).toBe(false);
  });
  it("artiklar från standardlistan flyttas till kundens egen lista", () => {
    const own: CatalogItem[] = [{ ...catalog[1], item_id: ID(20), unit_price: 239 }, catalog[0]];
    const draft = { customer_id: ID(50), requested_delivery_date: null, customer_reference: null, missing_information: [],
      items: [{ item_id: ID(2), description: "lax", quantity: 10, unit: "kg", reason: "x" }, { item_id: ID(1), description: "räkor", quantity: 5, unit: "kg", reason: "x" }, { item_id: ID(3), description: "pall", quantity: 1, unit: "pall", reason: "x" }] };
    const r = remapToCatalog(draft, catalog, own);
    expect(r.items.map((i) => i.item_id)).toEqual([ID(20), ID(1), null]);
    expect(assembleOrder(r, own).lines.map((l) => l.unit_price)).toEqual([239, 189, null]);
  });
  it("demoläge hittar kund, artiklar, mängder och datum", () => {
    const d = demoOrderDraft("Hej! Fiskhandeln AB vill beställa 500 kg räkor och 20 kg laxfilé till 2026-11-16. Ordernr: PO-4411",
      catalog, [{ id: ID(50), name: "Fiskhandeln AB", customer_number: 1001, company_name: null, email: null }], null, "2026-11-10");
    expect(d.customer_id).toBe(ID(50));
    expect(d.items.map((i) => [i.item_id, i.quantity])).toEqual([[ID(1), 500], [ID(2), 20]]);
    expect(d.requested_delivery_date).toBe("2026-11-16");
    expect(d.customer_reference).toBe("PO-4411");
    expect(d.missing_information).toEqual([]);
  });
  it("demoläge flaggar saknad information i stället för att gissa", () => {
    const d = demoOrderDraft("Skicka lite räkor", catalog, [], null, "2026-11-10");
    expect(d.customer_id).toBeNull();
    expect(d.missing_information).toEqual(expect.arrayContaining(["Vilken kund beställningen gäller", "Mängd för en eller flera artiklar", "Önskat leveransdatum"]));
  });
});

describe("orderbekräftelse", () => {
  it("renderar PDF med orderrubriker", async () => {
    const args = orderToPdf({
      order: { number: "ORD-1001", status: "confirmed", created_at: "2026-11-10T08:00:00Z", payment_terms_days: 30, discount_percent: 0, subtotal: 84500, discount_total: 0, vat_total: 10140, total: 94640, requested_delivery_date: "2026-11-16", customer_reference: "PO-4411" },
      items: [{ description: "Räkor kokta", quantity: 500, unit: "kg", unit_price: 169, discount_percent: 0, vat_rate: 12, line_total: 84500 }],
      organization: { name: "Västkust Fisk AB", org_number: null, email: null, phone: null, website: null, address: null, postal_code: null, city: null, brand_color: null },
      customer: { name: "Fiskhandeln AB", company_name: null, email: null, address: null, postal_code: null, city: null },
    }, { useBranding: false });
    expect(args.labels.title).toBe("ORDERBEKRÄFTELSE");
    expect(args.draftWatermark).toBe(false);
    const pdf = await renderQuotePdf(args);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
});
