import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { FREQUENCY, WEEKDAYS } from "@/lib/labels";
import type { Frequency, RecurringItem } from "@/lib/types";
import { describeSchedule, upcoming } from "@shared/schedule.ts";
import { formatNumber, formatSEK } from "@shared/pricing.ts";
import { cn, formatDate } from "@/lib/utils";
import { useCatalog, useCustomers, useRecurringOrder } from "@/hooks/business";
import { useInvalidate } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton } from "@/components/ui/misc";
import { CatalogPicker } from "@/components/business/CatalogPicker";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
type Draft = Omit<RecurringItem, "id" | "recurring_order_id" | "organization_id"> & { id?: string };
interface Form {
  customer_id: string; title: string; frequency: Frequency; interval_count: number; weekdays: number[]; day_of_month: number;
  start_date: string; end_date: string; lead_days: number; delivery_address: string; customer_reference: string; notes: string;
}

export default function RecurringOrderEditor() {
  const { id } = useParams();
  const isNew = id === "ny";
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const q = useRecurringOrder(id);
  const customers = useCustomers();
  const [f, setF] = useState<Form>({ customer_id: params.get("kund") ?? "", title: "", frequency: "weekly", interval_count: 1, weekdays: [1], day_of_month: 1, start_date: today(), end_date: "", lead_days: 2, delivery_address: "", customer_reference: "", notes: "" });
  const [items, setItems] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const r = q.data?.recurring;
  useEffect(() => {
    if (!r) return;
    setF({ customer_id: r.customer_id, title: r.title, frequency: r.frequency, interval_count: r.interval_count, weekdays: r.weekdays ?? [1], day_of_month: r.day_of_month ?? 1,
      start_date: r.start_date, end_date: r.end_date ?? "", lead_days: r.lead_days, delivery_address: r.delivery_address ?? "", customer_reference: r.customer_reference ?? "", notes: r.notes ?? "" });
    setItems(q.data!.items);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useCatalog(f.customer_id || undefined);
  const rule = { frequency: f.frequency, interval: f.interval_count, weekdays: f.weekdays, dayOfMonth: f.day_of_month, startDate: f.start_date || today(), endDate: f.end_date || null };
  const preview = useMemo(() => (f.start_date ? upcoming(rule, today() > f.start_date ? today() : f.start_date, 5) : []), [JSON.stringify(rule)]); // eslint-disable-line react-hooks/exhaustive-deps
  const priceOf = (it: Draft) => it.price_list_item_id ? catalog.data?.find((c) => c.item_id === it.price_list_item_id)?.unit_price ?? null : it.unit_price;
  const estimate = items.reduce((s, it) => { const p = priceOf(it); return p === null ? s : s + p * it.quantity; }, 0);

  if (!isNew && q.isLoading) return <Skeleton className="h-96" />;
  if (!isNew && !r) return <EmptyState title="Hittades inte" action={<Button variant="outline" asChild><Link to="/app/bestallningar?flik=aterkommande">Tillbaka</Link></Button>} />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.customer_id) return toast.error("Välj kund");
    if (!f.title.trim()) return toast.error("Ange en benämning");
    if (!items.length) return toast.error("Lägg till minst en artikel");
    if (f.end_date && f.end_date < f.start_date) return toast.error("Slutdatum måste vara efter startdatum");
    if (f.frequency === "weekly" && !f.weekdays.length) return toast.error("Välj minst en veckodag");
    setBusy(true);
    const row = {
      title: f.title.trim(), frequency: f.frequency, interval_count: f.interval_count, weekdays: f.frequency === "weekly" ? f.weekdays : null,
      day_of_month: f.frequency === "monthly" ? f.day_of_month : null, start_date: f.start_date, end_date: f.end_date || null, lead_days: f.lead_days,
      delivery_address: f.delivery_address || null, customer_reference: f.customer_reference || null, notes: f.notes || null,
    };
    try {
      let rid = r?.id;
      if (isNew) {
        const { data, error } = await supabase.from("recurring_orders").insert({ ...row, organization_id: org!.id, customer_id: f.customer_id }).select("id").single();
        if (error) throw error;
        rid = data.id;
      } else {
        const { error } = await supabase.from("recurring_orders").update(row).eq("id", rid!);
        if (error) throw error;
      }
      // Rader: ersätt hela uppsättningen (påverkar aldrig redan skapade order)
      const keep = items.filter((i) => i.id).map((i) => i.id!);
      if (!isNew) {
        const del = supabase.from("recurring_order_items").delete().eq("recurring_order_id", rid!);
        const { error } = keep.length ? await del.not("id", "in", `(${keep.join(",")})`) : await del;
        if (error) throw error;
      }
      for (const [i, it] of items.entries()) {
        const data = { price_list_item_id: it.price_list_item_id, sku: it.sku, description: it.description, quantity: it.quantity, unit: it.unit, unit_price: it.price_list_item_id ? null : it.unit_price, vat_rate: it.vat_rate, sort: i + 1 };
        const { error } = it.id ? await supabase.from("recurring_order_items").update(data).eq("id", it.id)
          : await supabase.from("recurring_order_items").insert({ ...data, organization_id: org!.id, recurring_order_id: rid });
        if (error) throw error;
      }
      toast.success(isNew ? "Den återkommande beställningen är skapad" : "Sparat");
      invalidate("recurring", "recurring_order", "dashboard", "business");
      if (isNew) navigate(`/app/bestallningar/aterkommande/${rid}`, { replace: true });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const setStatus = async (status: "active" | "paused" | "ended") => {
    if (status === "ended" && !confirm("Avsluta den återkommande beställningen? Inga fler order skapas.")) return;
    const { error } = await supabase.from("recurring_orders").update({ status }).eq("id", r!.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(status === "paused" ? "Pausad – inga order skapas förrän du återupptar" : status === "active" ? "Återupptagen" : "Avslutad");
    invalidate("recurring", "recurring_order", "business");
  };
  const remove = async () => {
    if (!confirm("Radera? Order som redan skapats finns kvar.")) return;
    const { error } = await supabase.from("recurring_orders").delete().eq("id", r!.id);
    if (error) return toast.error(errorMessage(error));
    invalidate("recurring");
    navigate("/app/bestallningar?flik=aterkommande");
  };

  return (
    <div>
      <Link to="/app/bestallningar?flik=aterkommande" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Återkommande beställningar</Link>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {r?.status === "active" && <Badge tone="success" dot>Aktiv</Badge>}
            {r?.status === "paused" && <Badge tone="warning" dot>Pausad</Badge>}
            {r?.status === "ended" && <Badge dot>Avslutad</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{isNew ? "Ny återkommande beställning" : r!.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{describeSchedule(rule)}{r?.next_occurrence ? ` · nästa ${formatDate(r.next_occurrence, { weekday: "long", day: "numeric", month: "long" })}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r?.status === "active" && <Button variant="outline" onClick={() => setStatus("paused")}><Pause />Pausa</Button>}
          {r?.status === "paused" && <Button variant="outline" onClick={() => setStatus("active")}><Play />Återuppta</Button>}
          <Button variant="brand" onClick={save} loading={busy}>{isNew ? "Skapa" : "Spara ändringar"}</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Kund och schema" />
            <CardBody className="grid gap-5 md:grid-cols-2">
              <Field label="Kund *">
                <Select value={f.customer_id} disabled={!isNew} onChange={(e) => { set("customer_id", e.target.value); setItems([]); }}>
                  <option value="">Välj kund…</option>{customers.data?.filter((c) => !c.anonymized_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Benämning *"><Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Räkor varje måndag" /></Field>
              <Field label="Frekvens"><Select value={f.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>{Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label={f.frequency === "daily" ? "Var x:e dag" : f.frequency === "weekly" ? "Var x:e vecka" : "Var x:e månad"}><Input type="number" min={1} max={12} value={f.interval_count} onChange={(e) => set("interval_count", Math.min(12, Math.max(1, Number(e.target.value) || 1)))} /></Field>
              {f.frequency === "weekly" && (
                <Field label="Veckodagar" className="md:col-span-2">
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d, i) => { const n = i + 1; const on = f.weekdays.includes(n); return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => set("weekdays", on ? f.weekdays.filter((x) => x !== n) : [...f.weekdays, n].sort())}
                        className={cn("h-9 min-w-[52px] rounded-lg border px-3 text-[13px] font-medium transition active:scale-[0.97]", on ? "border-brand bg-brand text-brand-foreground" : "bg-surface hover:bg-muted")}>{d}</button>
                    ); })}
                  </div>
                </Field>
              )}
              {f.frequency === "monthly" && <Field label="Dag i månaden" hint="31 = sista dagen i varje månad."><Input type="number" min={1} max={31} value={f.day_of_month} onChange={(e) => set("day_of_month", Math.min(31, Math.max(1, Number(e.target.value) || 1)))} /></Field>}
              <Field label="Startdatum *"><Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
              <Field label="Slutdatum" hint="Lämna tomt för tillsvidare."><Input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
              <Field label="Förbered order (dagar innan)" hint="Ordern skapas som 'väntar på godkännande' så här många dagar före leverans."><Input type="number" min={0} max={30} value={f.lead_days} onChange={(e) => set("lead_days", Math.min(30, Math.max(0, Number(e.target.value) || 0)))} /></Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Artiklar" description="Artiklar från prislistan får alltid kundens aktuella avtalspris när ordern skapas." />
            <CardBody className="space-y-3">
              {items.map((it, i) => {
                const p = priceOf(it);
                return (
                  <div key={it.id ?? i} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_110px_120px_40px] sm:items-center">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{it.description}</p><p className="font-mono text-[11px] text-muted-foreground">{it.sku ?? "egen rad"}{p !== null ? ` · ${formatSEK(p, { decimals: true })}/${it.unit}` : " · pris saknas"}</p></div>
                    <Input aria-label="Mängd" inputMode="decimal" defaultValue={String(it.quantity).replace(".", ",")} className="h-9 text-right font-mono"
                      onBlur={(e) => { const n = Number(e.target.value.replace(",", ".")); if (n > 0) setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: Math.round(n * 1000) / 1000 } : x))); }} />
                    <p className="text-right font-mono text-sm tabular">{p === null ? "–" : formatSEK(p * it.quantity, { decimals: true })}</p>
                    <Button variant="ghost" size="icon" aria-label="Ta bort" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                );
              })}
              <div className="rounded-xl border border-dashed bg-muted/30 p-3">
                {f.customer_id ? <CatalogPicker catalog={catalog.data ?? []} onAdd={(c, qty) => setItems((xs) => [...xs, { price_list_item_id: c.item_id, sku: c.sku, description: c.name, quantity: qty, unit: c.unit, unit_price: null, vat_rate: c.vat_rate, sort: xs.length + 1 }])} />
                  : <p className="text-sm text-muted-foreground">Välj kund först för att se kundens priser.</p>}
              </div>
              {items.length > 0 && <p className="text-right text-sm text-muted-foreground">Uppskattat per tillfälle: <span className="font-mono font-medium text-foreground">{formatSEK(estimate, { decimals: true })}</span> exkl. moms</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Leverans" />
            <CardBody className="grid gap-5 md:grid-cols-2">
              <Field label="Leveransadress"><Input value={f.delivery_address} onChange={(e) => set("delivery_address", e.target.value)} placeholder="Kundens standardadress används annars" /></Field>
              <Field label="Kundens referens"><Input value={f.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} /></Field>
              <Field label="Anteckningar" className="md:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-[72px]" /></Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-6">
            <CardHeader title={<span className="flex items-center gap-2"><CalendarClock className="size-4" />Kommande tillfällen</span>} />
            <CardBody>
              {r?.status === "paused" ? <p className="text-sm text-muted-foreground">Pausad. Inga order skapas förrän du återupptar.</p>
                : preview.length ? <ol className="space-y-2">{preview.map((d, i) => <li key={d} className="flex items-center justify-between text-sm"><span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span><span>{formatDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span></li>)}</ol>
                : <p className="text-sm text-muted-foreground">Inga fler tillfällen inom schemat.</p>}
              <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">Varje tillfälle blir en order som väntar på godkännande – aldrig dubbletter, och inget bekräftas automatiskt. {formatNumber(f.lead_days)} dagar i förväg.</p>
            </CardBody>
          </Card>
          {r && r.status !== "ended" && <div className="flex flex-col gap-2">
            <Button variant="ghost" onClick={() => setStatus("ended")}><Square />Avsluta</Button>
            <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 />Radera</Button>
          </div>}
          {isNew && <Button variant="ghost" asChild><Link to="/app/bestallningar?flik=aterkommande"><Plus className="rotate-45" />Avbryt</Link></Button>}
        </div>
      </div>
    </div>
  );
}
