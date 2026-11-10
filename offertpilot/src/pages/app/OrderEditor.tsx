import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Copy, Download, History, Lock, Plus, Send, Sparkles, Trash2, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import { ORDER_SOURCE, ORDER_STATUS, ORDER_TRANSITIONS } from "@/lib/labels";
import type { OrderItem, OrderStatus } from "@/lib/types";
import { computeTotals, formatNumber, formatSEK } from "@shared/pricing.ts";
import { cn, downloadBlob, formatDate, formatDateTime } from "@/lib/utils";
import { useCatalog, useOrder } from "@/hooks/business";
import { useInvalidate } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { CatalogPicker } from "@/components/business/CatalogPicker";

const parseNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));
const ACTION: Partial<Record<OrderStatus, { label: string; icon: typeof CheckCircle2; variant: "brand" | "outline" | "ghost" }>> = {
  confirmed: { label: "Bekräfta order", icon: CheckCircle2, variant: "brand" },
  pending_approval: { label: "Skicka för godkännande", icon: Send, variant: "outline" },
  in_progress: { label: "Markera som pågående", icon: Truck, variant: "outline" },
  delivered: { label: "Markera som levererad", icon: CheckCircle2, variant: "brand" },
  draft: { label: "Tillbaka till utkast", icon: ArrowLeft, variant: "ghost" },
  cancelled: { label: "Makulera", icon: Ban, variant: "ghost" },
};

function NumCell({ value, onCommit, disabled, label, placeholder, invalid }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean; label: string; placeholder?: string; invalid?: boolean }) {
  const [v, setV] = useState(value === null ? "" : String(value).replace(".", ","));
  useEffect(() => setV(value === null ? "" : String(value).replace(".", ",")), [value]);
  return <Input aria-label={label} aria-invalid={invalid || undefined} disabled={disabled} inputMode="decimal" value={v} placeholder={placeholder}
    onChange={(e) => setV(e.target.value)} className="h-9 text-right font-mono tabular"
    onBlur={() => { const n = parseNum(v); if (n === null || (Number.isFinite(n) && n >= 0)) { if (n !== value) onCommit(n); } else setV(value === null ? "" : String(value)); }} />;
}

export default function OrderEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useOrg();
  const invalidate = useInvalidate();
  const q = useOrder(id);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusDialog, setStatusDialog] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (q.data) setItems(q.data.items); }, [q.data]);
  const order = q.data?.order;
  const catalog = useCatalog(order?.customer_id);
  const totals = useMemo(() => computeTotals(items, { discount_type: "percent", discount_value: order?.discount_percent ?? 0, apply_rot: false, rot_percent: 0 }), [items, order?.discount_percent]);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-96" /></div>;
  if (!order) return <EmptyState title="Ordern hittades inte" action={<Button variant="outline" asChild><Link to="/app/bestallningar">Till beställningar</Link></Button>} />;
  const editable = order.status === "draft" || order.status === "pending_approval";
  const refresh = () => invalidate("order", "orders", "dashboard", "business", "tasks", "tasks-due-count");
  const missing = items.some((i) => i.unit_price === null);

  const saveOrder = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (error) { toast.error(errorMessage(error)); refresh(); } else invalidate("order");
  };
  const saveItem = async (itemId: string, patch: Partial<OrderItem>) => {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("order_items").update(patch).eq("id", itemId);
    if (error) { toast.error(errorMessage(error)); refresh(); } else invalidate("order");
  };
  const addLine = async (line: Partial<OrderItem>) => {
    const { error } = await supabase.from("order_items").insert({ organization_id: order.organization_id, order_id: order.id, sort: items.length + 1, ...line });
    if (error) return toast.error(errorMessage(error));
    refresh();
  };
  const changeStatus = async (s: OrderStatus) => {
    setBusy(s);
    const { error } = await supabase.rpc("set_order_status", { oid: order.id, new_status: s, note: note || null });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    setStatusDialog(null); setNote("");
    toast.success(`Ordern är nu: ${ORDER_STATUS[s].label.toLowerCase()}`);
    refresh();
  };
  const pdf = async () => {
    setBusy("pdf");
    try {
      const [{ loadOrderDoc, orderToPdf }, { renderQuotePdf }] = await Promise.all([import("@shared/order-data.ts"), import("@shared/quote-pdf.ts")]);
      const d = await loadOrderDoc(supabase, order.id);
      downloadBlob(await renderQuotePdf(orderToPdf(d.doc, { footer: d.footer, useBranding: d.branding })) as BlobPart, `Orderbekraftelse-${order.number}.pdf`, "application/pdf");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const send = async () => {
    setBusy("send");
    try {
      const r = await callFunction<{ demo?: boolean; message?: string }>("send-order", { order_id: order.id });
      r.demo ? toast.warning(r.message ?? "Demoläge") : toast.success("Orderbekräftelsen är skickad");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const duplicate = async () => {
    const { data, error } = await supabase.rpc("duplicate_order", { oid: order.id });
    if (error) return toast.error(errorMessage(error));
    toast.success("Ordern är duplicerad med dagens priser");
    refresh();
    navigate(`/app/bestallningar/${data}`);
  };
  const st = ORDER_STATUS[order.status];
  const transitions = ORDER_TRANSITIONS[order.status];
  const warnings = order.ai_warnings ?? [];

  return (
    <div>
      <Link to="/app/bestallningar" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Alla beställningar</Link>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{order.number}</span>
            <Badge tone={st.tone} dot>{st.label}</Badge>
            <Badge>{order.ai_generated && <Sparkles className="size-3" />}{ORDER_SOURCE[order.source]}</Badge>
            {!editable && <Badge><Lock className="size-3" />Låst</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]"><Link to={`/app/kunder/${order.customer_id}`} className="hover:text-brand">{order.customers?.name}</Link></h1>
          <p className="mt-1 text-sm text-muted-foreground">Skapad {formatDate(order.created_at)}{order.occurrence_date ? ` · återkommande tillfälle ${formatDate(order.occurrence_date)}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={pdf} loading={busy === "pdf"}><Download />PDF</Button>
          {["confirmed", "in_progress", "delivered"].includes(order.status) && <Button variant="outline" onClick={send} loading={busy === "send"}><Send />Skicka bekräftelse</Button>}
          {transitions.filter((s) => ["confirmed", "delivered", "in_progress"].includes(s)).map((s) => {
            const a = ACTION[s]!;
            return <Button key={s} variant={a.variant} onClick={() => s === "confirmed" ? changeStatus(s) : setStatusDialog(s)} loading={busy === s} disabled={s === "confirmed" && missing} title={s === "confirmed" && missing ? "Fyll i alla priser först" : undefined}><a.icon />{a.label}</Button>;
          })}
        </div>
      </div>

      {order.status === "pending_approval" && <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-warning"><AlertTriangle /><div>Ordern väntar på godkännande{order.source === "portal" ? " – kunden lade den via kundportalen" : order.source === "recurring" ? " – förberedd automatiskt från en återkommande beställning" : ""}. Kontrollera och bekräfta.</div></div>}
      {missing && editable && <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-warning"><AlertTriangle /><div>En eller flera rader saknar pris. Priser hittas aldrig på – fyll i dem innan ordern bekräftas.</div></div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {warnings.length > 0 && (
            <Card className="border-warning/30">
              <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" />Att granska</span>} />
              <CardBody><ul className="space-y-2 text-sm">{warnings.map((w, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />{w}</li>)}</ul></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Orderrader" description="Priser exkl. moms. Priser från prislistan kopieras till ordern och ändras aldrig i efterhand." />
            <CardBody className="overflow-x-auto px-0 pb-2">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b text-left">{["Beskrivning", "Mängd", "Enhet", "À-pris", "Rabatt %", "Moms", "Summa", ""].map((h, i) => <th key={i} className={cn("label-mono px-3 pb-3 font-normal first:pl-5", [1, 3, 4, 6].includes(i) && "text-right")}>{h}</th>)}</tr></thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b align-top last:border-0">
                      <td className="min-w-[220px] py-2.5 pl-5 pr-3">{editable ? <Input aria-label="Beskrivning" defaultValue={it.description} onBlur={(e) => e.target.value.trim() && e.target.value !== it.description && saveItem(it.id, { description: e.target.value.trim() })} className="h-9" /> : <p className="pt-1.5">{it.description}</p>}{it.sku && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{it.sku}{it.price_list_item_id ? " · från prislista" : ""}</p>}</td>
                      <td className="w-[100px] px-2 py-2.5">{editable ? <NumCell label="Mängd" value={it.quantity} onCommit={(v) => v && v > 0 && saveItem(it.id, { quantity: v })} /> : <p className="pt-1.5 text-right font-mono">{formatNumber(it.quantity, 3)}</p>}</td>
                      <td className="w-[80px] px-2 py-2.5"><p className="pt-1.5">{it.unit}</p></td>
                      <td className="w-[120px] px-2 py-2.5">{editable ? <NumCell label="À-pris" value={it.unit_price} placeholder="Pris saknas" invalid={it.unit_price === null} onCommit={(v) => saveItem(it.id, { unit_price: v })} /> : <p className="pt-1.5 text-right font-mono">{formatSEK(it.unit_price, { decimals: true })}</p>}</td>
                      <td className="w-[90px] px-2 py-2.5">{editable ? <NumCell label="Rabatt" value={it.discount_percent} onCommit={(v) => saveItem(it.id, { discount_percent: Math.min(100, v ?? 0) })} /> : <p className="pt-1.5 text-right font-mono">{formatNumber(it.discount_percent)}</p>}</td>
                      <td className="w-[86px] px-2 py-2.5">{editable ? <Select aria-label="Moms" className="h-9 text-[13px]" value={it.vat_rate} onChange={(e) => saveItem(it.id, { vat_rate: Number(e.target.value) })}>{[25, 12, 6, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</Select> : <p className="pt-1.5">{formatNumber(it.vat_rate)} %</p>}</td>
                      <td className="w-[120px] px-3 py-2.5 text-right font-mono tabular"><p className="pt-1.5">{it.unit_price === null ? <span className="text-warning">–</span> : formatSEK(Math.round(it.quantity * it.unit_price * (1 - it.discount_percent / 100) * 100) / 100, { decimals: true })}</p></td>
                      <td className="w-[44px] py-2.5 pr-4">{editable && <Button variant="ghost" size="icon" aria-label="Ta bort rad" onClick={async () => { setItems((xs) => xs.filter((x) => x.id !== it.id)); await supabase.from("order_items").delete().eq("id", it.id); refresh(); }}><Trash2 /></Button>}</td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">Inga rader ännu. Välj artiklar från kundens prislista nedan.</td></tr>}
                </tbody>
              </table>
              {editable && (
                <div className="mx-5 mt-4 space-y-2 rounded-xl border border-dashed bg-muted/30 p-3">
                  <CatalogPicker catalog={catalog.data ?? []} onAdd={(c, qty, price) => addLine({ price_list_item_id: c.item_id, sku: c.sku, description: c.name, quantity: qty, unit: c.unit, unit_price: price, vat_rate: c.vat_rate })} />
                  <Button size="sm" variant="ghost" onClick={() => addLine({ description: "Egen rad", quantity: 1, unit: "st", unit_price: null, vat_rate: settings?.default_vat_rate ?? 25 })}><Plus />Egen rad utan prislista</Button>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Leverans och anteckningar" />
            <CardBody className="grid gap-5 md:grid-cols-2">
              <Field label="Önskat leveransdatum"><Input type="date" disabled={!editable} defaultValue={order.requested_delivery_date ?? ""} onBlur={(e) => e.target.value !== (order.requested_delivery_date ?? "") && saveOrder({ requested_delivery_date: e.target.value || null })} /></Field>
              <Field label="Faktiskt leveransdatum"><Input type="date" defaultValue={order.delivery_date ?? ""} onBlur={(e) => e.target.value !== (order.delivery_date ?? "") && saveOrder({ delivery_date: e.target.value || null })} /></Field>
              <Field label="Kundens referens / ordernr"><Input disabled={!editable} defaultValue={order.customer_reference ?? ""} onBlur={(e) => e.target.value !== (order.customer_reference ?? "") && saveOrder({ customer_reference: e.target.value || null })} /></Field>
              <Field label="Leveransadress"><Input disabled={!editable} defaultValue={order.delivery_address ?? ""} onBlur={(e) => e.target.value !== (order.delivery_address ?? "") && saveOrder({ delivery_address: e.target.value || null })} /></Field>
              <Field label="Meddelande till kunden" hint="Visas på orderbekräftelsen och i kundportalen." className="md:col-span-2"><Textarea disabled={!editable} defaultValue={order.notes_customer ?? ""} onBlur={(e) => e.target.value !== (order.notes_customer ?? "") && saveOrder({ notes_customer: e.target.value || null })} className="min-h-[72px]" /></Field>
              <Field label="Interna anteckningar" hint="Visas aldrig för kunden." className="md:col-span-2"><Textarea defaultValue={order.notes_internal ?? ""} onBlur={(e) => e.target.value !== (order.notes_internal ?? "") && saveOrder({ notes_internal: e.target.value || null })} className="min-h-[72px]" /></Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-6">
            <CardHeader title="Summering" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kundrabatt %"><NumCell label="Kundrabatt" disabled={!editable} value={order.discount_percent} onCommit={(v) => saveOrder({ discount_percent: Math.min(100, v ?? 0) })} /></Field>
                <Field label="Betalning (dagar)"><NumCell label="Betalningsvillkor" disabled={!editable} value={order.payment_terms_days} onCommit={(v) => saveOrder({ payment_terms_days: Math.round(v ?? 30) })} /></Field>
              </div>
              <dl className="space-y-2.5 border-t pt-4 text-sm">
                <div className="flex justify-between"><dt>Summa exkl. moms</dt><dd className="font-mono tabular">{formatSEK(totals.subtotal, { decimals: true })}</dd></div>
                {totals.discount_total > 0 && <div className="flex justify-between"><dt>Kundrabatt</dt><dd className="font-mono tabular">−{formatSEK(totals.discount_total, { decimals: true })}</dd></div>}
                {totals.vat_breakdown.filter((b) => b.rate > 0).map((b) => <div key={b.rate} className="flex justify-between text-muted-foreground"><dt>Moms {formatNumber(b.rate)} %</dt><dd className="font-mono tabular">{formatSEK(b.vat, { decimals: true })}</dd></div>)}
                <div className="flex justify-between border-t pt-2.5 text-[15px] font-semibold"><dt>Totalt inkl. moms</dt><dd className="font-mono tabular">{formatSEK(totals.total, { decimals: true })}</dd></div>
              </dl>
              <p className="text-[11px] text-muted-foreground">Summorna räknas om och verifieras på servern vid varje ändring.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><History className="size-4" />Orderhistorik</span>} />
            <CardBody className="space-y-2.5">
              {q.data!.history.map((h) => (
                <div key={h.id} className="text-[13px]">
                  <div className="flex justify-between gap-3"><span>{ORDER_STATUS[h.to_status as OrderStatus]?.label ?? h.to_status}</span><span className="text-xs text-muted-foreground">{formatDateTime(h.created_at)}</span></div>
                  {h.note && <p className="text-xs text-muted-foreground">”{h.note}”</p>}
                </div>
              ))}
            </CardBody>
          </Card>
          <div className="flex flex-col gap-2">
            <Button variant="ghost" onClick={duplicate}><Copy />Duplicera order</Button>
            {transitions.filter((s) => ["pending_approval", "draft", "cancelled"].includes(s)).map((s) => { const a = ACTION[s]!; return <Button key={s} variant="ghost" className={s === "cancelled" ? "text-destructive" : undefined} onClick={() => setStatusDialog(s)}><a.icon />{a.label}</Button>; })}
            {order.status === "draft" && <Button variant="ghost" className="text-destructive" onClick={async () => {
              if (!confirm("Radera utkastet?")) return;
              const { error } = await supabase.from("orders").delete().eq("id", order.id);
              if (error) return toast.error(errorMessage(error));
              refresh(); navigate("/app/bestallningar");
            }}><Trash2 />Radera utkast</Button>}
          </div>
        </div>
      </div>

      <Dialog open={!!statusDialog} onOpenChange={(o) => !o && setStatusDialog(null)} title={statusDialog ? ACTION[statusDialog]?.label ?? "" : ""} description="Ändringen sparas i orderhistoriken."
        footer={<><Button variant="ghost" onClick={() => setStatusDialog(null)}>Avbryt</Button><Button variant={statusDialog === "cancelled" ? "destructive" : "brand"} onClick={() => statusDialog && changeStatus(statusDialog)} loading={!!busy}>Bekräfta</Button></>}>
        <Field label="Kommentar (valfritt)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={statusDialog === "cancelled" ? "Kunden avbokade" : "Levererad till lastkaj 3"} /></Field>
      </Dialog>
    </div>
  );
}
