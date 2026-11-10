// Prislistor: pris per enhet med mängdrabatt. Speglar public.effective_unit_price().
export interface PriceTier { min_quantity: number; unit_price: number }
export interface CatalogItem {
  item_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  unit_price: number;
  vat_rate: number;
  tiers: PriceTier[];
  price_list_name?: string;
  customer_specific?: boolean;
}

/** Högsta trappsteg som mängden når, annars grundpriset. */
export function tierPrice(item: Pick<CatalogItem, "unit_price" | "tiers">, quantity: number): number {
  let price = Number(item.unit_price);
  let best = 0;
  for (const t of item.tiers ?? []) {
    const min = Number(t.min_quantity);
    if (quantity >= min && min >= best) { best = min; price = Number(t.unit_price); }
  }
  return price;
}

export const normalizeCatalog = (rows: Record<string, unknown>[]): CatalogItem[] =>
  rows.map((r) => ({
    ...(r as unknown as CatalogItem),
    unit_price: Number(r.unit_price),
    vat_rate: Number(r.vat_rate),
    tiers: ((r.tiers as PriceTier[]) ?? []).map((t) => ({ min_quantity: Number(t.min_quantity), unit_price: Number(t.unit_price) })),
  }));

export const UNITS = ["kg", "st", "tim", "liter", "pall", "låda", "m²", "m", "ton", "dag", "paket"];
