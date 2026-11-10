import { useState } from "react";
import { Plus } from "lucide-react";
import { formatSEK } from "@shared/pricing.ts";
import { tierPrice, type CatalogItem } from "@shared/price-lists.ts";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/** Välj artikel ur kundens prisbild och mängd. Priset (inkl. mängdrabatt) räknas fram, aldrig gissas. */
export function CatalogPicker({ catalog, onAdd, disabled }: { catalog: CatalogItem[]; onAdd: (item: CatalogItem, quantity: number, unitPrice: number) => void; disabled?: boolean }) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const item = catalog.find((c) => c.item_id === itemId);
  const quantity = Number(qty.replace(",", "."));
  const price = item && quantity > 0 ? tierPrice(item, quantity) : null;
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-center">
      <Select aria-label="Artikel från prislista" value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={disabled || !catalog.length} className="h-9 text-[13px]">
        <option value="">{catalog.length ? "Välj artikel från prislistan…" : "Kunden har ingen prislista"}</option>
        {catalog.map((c) => <option key={c.item_id} value={c.item_id}>{c.sku ? `${c.sku} – ` : ""}{c.name} · {formatSEK(c.unit_price, { decimals: true })}/{c.unit}{c.customer_specific ? " (kundpris)" : ""}</option>)}
      </Select>
      <Input aria-label="Mängd" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 text-right font-mono" placeholder="Mängd" />
      <Button size="sm" className="h-9" disabled={!item || !(quantity > 0) || disabled} onClick={() => { if (item && price !== null) { onAdd(item, Math.round(quantity * 1000) / 1000, price); setItemId(""); setQty("1"); } }}>
        <Plus />Lägg till{price !== null && item ? ` (${formatSEK(price, { decimals: true })}/${item.unit})` : ""}
      </Button>
    </div>
  );
}
