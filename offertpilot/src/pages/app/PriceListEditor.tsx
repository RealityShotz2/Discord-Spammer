import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, History, Layers, Plus, Search, Star, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import type { PriceListItem } from "@/lib/types";
import { formatNumber, formatSEK } from "@shared/pricing.ts";
import { UNITS } from "@shared/price-lists.ts";
import { formatDateTime } from "@/lib/utils";
import { usePriceList } from "@/hooks/business";
import { useInvalidate, useServices } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";

const parseNum = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

function TiersDialog({ item, onClose, editable }: { item: PriceListItem | null; onClose: () => void; editable: boolean }) {
  const invalidate = useInvalidate();
  const [minQ, setMinQ] = useState("");
  const [price, setPrice] = useState("");
  const history = useQuery({
    queryKey: ["price-history", item?.id], enabled: !!item,
    queryFn: async () => (await supabase.from("price_list_item_history").select("*").eq("item_id", item!.id).order("changed_at", { ascending: false }).limit(20)).data ?? [],
  });
  if (!item) return null;
  const add = async () => {
    const q = parseNum(minQ), p = parseNum(price);
    if (!(q > 0) || !(p >= 0)) return toast.error("Ange en mängd större än 0 och ett giltigt pris");
    const { error } = await supabase.from("price_list_item_tiers").insert({ organization_id: item.organization_id, item_id: item.id, min_quantity: q, unit_price: p });
    if (error) return toast.error(error.code === "23505" ? "Det finns redan ett trappsteg för den mängden" : errorMessage(error));
    setMinQ(""); setPrice("");
    invalidate("price_list");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Mängdrabatt – ${item.name}`} description={`Grundpris ${formatSEK(item.unit_price, { decimals: true })}/${item.unit}. Högsta trappsteg som mängden når gäller.`}>
      <div className="space-y-4">
        <div className="space-y-2">
          {(item.price_list_item_tiers ?? []).length ? item.price_list_item_tiers!.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
              <span>Från <span className="font-mono">{formatNumber(t.min_quantity, 3)} {item.unit}</span></span>
              <span className="flex items-center gap-2"><span className="font-mono">{formatSEK(t.unit_price, { decimals: true })}/{item.unit}</span>
                {editable && <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { await supabase.from("price_list_item_tiers").delete().eq("id", t.id); invalidate("price_list"); }}><Trash2 /></Button>}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">Inga mängdrabatter.</p>}
        </div>
        {editable && <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label={`Från mängd (${item.unit})`}><Input inputMode="decimal" value={minQ} onChange={(e) => setMinQ(e.target.value)} placeholder="500" /></Field>
          <Field label="Pris per enhet"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="38,00" /></Field>
          <Button onClick={add}><Plus />Lägg till</Button>
        </div>}
        {!!history.data?.length && (
          <div className="border-t pt-4">
            <p className="label-mono mb-2 flex items-center gap-1.5"><History className="size-3.5" />Prishistorik</p>
            <ul className="space-y-1 text-xs text-muted-foreground">{history.data.map((h) => <li key={h.id}>{formatDateTime(h.changed_at)}: {formatSEK(Number(h.old_unit_price), { decimals: true })} → {formatSEK(Number(h.new_unit_price), { decimals: true })}</li>)}</ul>
            <p className="mt-2 text-[11px] text-muted-foreground">Befintliga order behåller alltid sitt ursprungliga pris.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PriceInput({ value, onCommit, disabled, label }: { value: number; onCommit: (v: number) => void; disabled?: boolean; label: string }) {
  const [v, setV] = useState(String(value).replace(".", ","));
  useEffect(() => setV(String(value).replace(".", ",")), [value]);
  return <Input aria-label={label} disabled={disabled} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className="h-9 text-right font-mono tabular"
    onBlur={() => { const n = parseNum(v); if (Number.isFinite(n) && n >= 0) { if (n !== value) onCommit(n); } else setV(String(value)); }} />;
}

export default function PriceListEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, settings } = useOrg();
  const invalidate = useInvalidate();
  const data = usePriceList(id);
  const services = useServices();
  const [q, setQ] = useState("");
  const [tiersFor, setTiersFor] = useState<string | null>(null);
  const [n, setN] = useState({ sku: "", name: "", unit: "kg", price: "", vat: String(settings?.default_vat_rate ?? 25) });

  if (data.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  if (!data.data) return <EmptyState title="Prislistan hittades inte" action={<Button variant="outline" asChild><Link to="/app/prislistor">Till prislistor</Link></Button>} />;
  const { list, items } = data.data;
  const editable = isAdmin;
  const shown = items.filter((i) => !q.trim() || [i.name, i.sku, i.description].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())));
  const tierItem = items.find((i) => i.id === tiersFor) ?? null;

  const saveList = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("price_lists").update(patch).eq("id", list.id);
    if (error) return toast.error(error.code === "23505" ? "Det finns redan en standardlista" : errorMessage(error));
    invalidate("price_list", "price_lists", "catalog");
  };
  const makeDefault = async () => {
    await supabase.from("price_lists").update({ is_default: false }).eq("organization_id", list.organization_id).eq("is_default", true);
    await saveList({ is_default: true });
    toast.success("Listan är nu standard för alla kunder");
  };
  const saveItem = async (itemId: string, patch: Partial<PriceListItem>) => {
    const { error } = await supabase.from("price_list_items").update(patch).eq("id", itemId);
    if (error) return toast.error(errorMessage(error));
    invalidate("price_list", "catalog");
  };
  const addItem = async () => {
    const price = parseNum(n.price);
    if (!n.name.trim() || !(price >= 0) || n.price === "") return toast.error("Ange namn och pris");
    const { error } = await supabase.from("price_list_items").insert({ organization_id: list.organization_id, price_list_id: list.id, sku: n.sku.trim() || null,
      name: n.name.trim(), unit: n.unit.trim() || "st", unit_price: price, vat_rate: parseNum(n.vat) || 0, sort: items.length });
    if (error) return toast.error(errorMessage(error));
    setN({ ...n, sku: "", name: "", price: "" });
    invalidate("price_list", "price_lists", "catalog");
  };
  const importServices = async () => {
    const rows = (services.data ?? []).filter((s) => s.active && s.unit_price !== null && !items.some((i) => i.service_id === s.id));
    if (!rows.length) return toast.info("Alla tjänster med pris finns redan i listan");
    const { error } = await supabase.from("price_list_items").insert(rows.map((s, i) => ({ organization_id: list.organization_id, price_list_id: list.id, service_id: s.id,
      name: s.name, description: s.description, unit: s.unit, unit_price: s.unit_price, vat_rate: s.vat_rate, sort: items.length + i })));
    if (error) return toast.error(errorMessage(error));
    toast.success(`${rows.length} tjänster kopierades från katalogen (katalogen är oförändrad)`);
    invalidate("price_list", "price_lists", "catalog");
  };

  return (
    <div>
      <Link to="/app/prislistor" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Alla prislistor</Link>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {list.is_default && <Badge tone="brand"><Star className="size-3" />Standard för alla kunder</Badge>}
            {list.customer_id && <Badge>Kundspecifik: <Link to={`/app/kunder/${list.customer_id}`} className="ml-1 underline-offset-2 hover:underline">{list.customers?.name}</Link></Badge>}
            {!list.active && <Badge tone="warning">Inaktiv</Badge>}
          </div>
          {editable ? <input aria-label="Prislistans namn" defaultValue={list.name} onBlur={(e) => e.target.value.trim() && e.target.value !== list.name && saveList({ name: e.target.value.trim() })}
            className="w-full max-w-2xl rounded-lg bg-transparent text-2xl font-semibold tracking-tight outline-none transition hover:bg-muted/50 focus:bg-muted/50 sm:text-[28px]" />
            : <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{list.name}</h1>}
        </div>
        {editable && <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={importServices}><Download />Importera från tjänstekatalogen</Button>
          {!list.is_default && !list.customer_id && <Button variant="outline" onClick={makeDefault}><Star />Gör till standard</Button>}
        </div>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="min-w-0">
          <CardHeader title="Artiklar och tjänster" description="Priser exkl. moms. Ändringar påverkar nya order – befintliga order behåller sitt pris."
            action={<div className="relative w-44"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök…" className="h-9 pl-8 text-[13px]" aria-label="Sök artiklar" /></div>} />
          <CardBody className="overflow-x-auto px-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left">{["Art.nr", "Benämning", "Enhet", "Pris", "Moms", "Mängdrabatt", "Aktiv", ""].map((h, i) => <th key={i} className="label-mono px-3 pb-3 font-normal first:pl-5">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-b align-middle last:border-0">
                    <td className="w-[110px] py-2 pl-5 pr-2">{editable ? <Input aria-label="Artikelnummer" defaultValue={i.sku ?? ""} onBlur={(e) => e.target.value !== (i.sku ?? "") && saveItem(i.id, { sku: e.target.value || null })} className="h-9 font-mono text-xs" /> : <span className="font-mono text-xs">{i.sku}</span>}</td>
                    <td className="min-w-[200px] px-2 py-2">{editable ? <Input aria-label="Benämning" defaultValue={i.name} onBlur={(e) => e.target.value.trim() && e.target.value !== i.name && saveItem(i.id, { name: e.target.value.trim() })} className="h-9" /> : i.name}</td>
                    <td className="w-[96px] px-2 py-2">{editable ? <Input aria-label="Enhet" list="units" defaultValue={i.unit} onBlur={(e) => e.target.value.trim() && e.target.value !== i.unit && saveItem(i.id, { unit: e.target.value.trim() })} className="h-9" /> : i.unit}</td>
                    <td className="w-[120px] px-2 py-2"><PriceInput label="Pris" disabled={!editable} value={i.unit_price} onCommit={(v) => saveItem(i.id, { unit_price: v })} /></td>
                    <td className="w-[90px] px-2 py-2"><Select aria-label="Moms" disabled={!editable} className="h-9 text-[13px]" value={i.vat_rate} onChange={(e) => saveItem(i.id, { vat_rate: Number(e.target.value) })}>{[25, 12, 6, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</Select></td>
                    <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => setTiersFor(i.id)}><Layers />{i.price_list_item_tiers?.length ? `${i.price_list_item_tiers.length} steg` : editable ? "Lägg till" : "–"}</Button></td>
                    <td className="px-2 py-2"><Switch label="Aktiv" disabled={!editable} checked={i.active} onCheckedChange={(v) => saveItem(i.id, { active: v })} /></td>
                    <td className="py-2 pr-4">{editable && <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => {
                      const { error } = await supabase.from("price_list_items").delete().eq("id", i.id);
                      if (error) return toast.error(errorMessage(error));
                      invalidate("price_list", "price_lists", "catalog");
                    }}><Trash2 /></Button>}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">Inga artiklar ännu. Lägg till nedan eller importera från tjänstekatalogen.</td></tr>}
              </tbody>
            </table>
            <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            {editable && (
              <div className="mx-5 mt-4 grid gap-2 rounded-xl border border-dashed bg-muted/30 p-3 sm:grid-cols-[100px_minmax(0,1fr)_90px_110px_90px_auto] sm:items-end">
                <Field label="Art.nr"><Input value={n.sku} onChange={(e) => setN({ ...n, sku: e.target.value })} placeholder="RAK-1" className="h-9" /></Field>
                <Field label="Benämning"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="Packning räkor" className="h-9" /></Field>
                <Field label="Enhet"><Input list="units" value={n.unit} onChange={(e) => setN({ ...n, unit: e.target.value })} className="h-9" /></Field>
                <Field label="Pris (kr)"><Input inputMode="decimal" value={n.price} onChange={(e) => setN({ ...n, price: e.target.value })} placeholder="42,00" className="h-9" /></Field>
                <Field label="Moms"><Select value={n.vat} onChange={(e) => setN({ ...n, vat: e.target.value })} className="h-9 text-[13px]">{[25, 12, 6, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</Select></Field>
                <Button size="sm" onClick={addItem} className="h-9"><Plus />Lägg till</Button>
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Inställningar" />
          <CardBody className="space-y-4">
            <Field label="Beskrivning"><Textarea disabled={!editable} defaultValue={list.description ?? ""} onBlur={(e) => e.target.value !== (list.description ?? "") && saveList({ description: e.target.value || null })} className="min-h-[72px]" /></Field>
            <Field label="Giltig från"><Input type="date" disabled={!editable} defaultValue={list.valid_from ?? ""} onBlur={(e) => saveList({ valid_from: e.target.value || null })} /></Field>
            <Field label="Giltig till"><Input type="date" disabled={!editable} defaultValue={list.valid_to ?? ""} onBlur={(e) => saveList({ valid_to: e.target.value || null })} /></Field>
            <label className="flex items-center justify-between text-sm"><span>Aktiv</span><Switch label="Aktiv" disabled={!editable} checked={list.active} onCheckedChange={(v) => saveList({ active: v })} /></label>
            {editable && !list.is_default && <Button variant="ghost" className="w-full text-destructive" onClick={async () => {
              if (!confirm(`Radera prislistan ${list.name}? Befintliga order påverkas inte.`)) return;
              const { error } = await supabase.from("price_lists").delete().eq("id", list.id);
              if (error) return toast.error(errorMessage(error));
              invalidate("price_lists", "catalog");
              navigate("/app/prislistor");
            }}><Trash2 />Radera prislista</Button>}
          </CardBody>
        </Card>
      </div>
      <TiersDialog item={tierItem} onClose={() => setTiersFor(null)} editable={editable} />
    </div>
  );
}
