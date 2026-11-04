// Prisberäkning för offerter. Speglar public.quotations_compute_totals() i databasen,
// som är den auktoritativa beräkningen. Används för förhandsvisning och PDF.
// Belopp räknas i öre (heltal) och avrundas på samma ställen som i SQL.

export interface PricedItem {
  quantity: number;
  unit_price: number | null;
  discount_percent?: number | null;
  vat_rate: number;
  is_labor?: boolean | null;
}

export interface QuoteAdjustments {
  discount_type: "none" | "percent" | "amount";
  discount_value: number;
  apply_rot: boolean;
  rot_percent: number;
}

export interface QuoteTotals {
  subtotal: number;
  discount_total: number;
  vat_total: number;
  total: number;
  rot_deduction: number;
  total_to_pay: number;
  requires_manual_input: boolean;
  vat_breakdown: { rate: number; base: number; vat: number }[];
}

/** Avrundning till två decimaler, "half away from zero" som PostgreSQL numeric. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

export function lineTotal(item: PricedItem): number {
  const price = item.unit_price ?? 0;
  const disc = item.discount_percent ?? 0;
  return round2(item.quantity * price * (1 - disc / 100));
}

export function computeTotals(items: PricedItem[], adj: QuoteAdjustments): QuoteTotals {
  const lines = items.map((i) => ({ ...i, line_total: lineTotal(i) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));

  let discount = 0;
  if (adj.discount_type === "percent") discount = round2((subtotal * adj.discount_value) / 100);
  else if (adj.discount_type === "amount") discount = Math.min(adj.discount_value, subtotal);
  const ratio = subtotal > 0 ? discount / subtotal : 0;

  const byRate = new Map<number, number>();
  let vatRaw = 0;
  let laborGross = 0;
  for (const l of lines) {
    const base = l.line_total * (1 - ratio);
    vatRaw += (base * l.vat_rate) / 100;
    byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + base);
    if (l.is_labor) laborGross += base * (1 + l.vat_rate / 100);
  }
  const vat = round2(vatRaw);
  const total = round2(subtotal - discount + vat);
  const rot = adj.apply_rot ? round2((laborGross * adj.rot_percent) / 100) : 0;

  return {
    subtotal,
    discount_total: round2(discount),
    vat_total: vat,
    total,
    rot_deduction: rot,
    total_to_pay: round2(total - rot),
    requires_manual_input: items.some((i) => i.unit_price === null || i.unit_price === undefined),
    vat_breakdown: [...byRate.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, base]) => ({ rate, base: round2(base), vat: round2((base * rate) / 100) })),
  };
}

/** Svensk valutaformatering, t.ex. "19 771,88 kr". */
export function formatSEK(value: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const decimals = opts.decimals ?? !Number.isInteger(value);
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(value);
}

export function formatNumber(value: number, maxDecimals = 2): string {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: maxDecimals }).format(value);
}
