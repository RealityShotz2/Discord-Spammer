import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Pause, Play, Plus, Repeat, Search, ShoppingCart, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { ORDER_SOURCE, ORDER_STATUS } from "@/lib/labels";
import type { OrderStatus } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { describeSchedule } from "@shared/schedule.ts";
import { cn, formatDate } from "@/lib/utils";
import { useCustomers, useOrders, useRecurringOrders } from "@/hooks/business";
import { useAiTask, useInvalidate } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";

const FILTERS: { id: OrderStatus | "open" | "all"; label: string }[] = [
  { id: "open", label: "Pågående" }, { id: "pending_approval", label: "Att godkänna" }, { id: "draft", label: "Utkast" },
  { id: "confirmed", label: "Bekräftade" }, { id: "delivered", label: "Levererade" }, { id: "cancelled", label: "Makulerade" }, { id: "all", label: "Alla" },
];

function NewOrderDialog({ open, onOpenChange, presetCustomer }: { open: boolean; onOpenChange: (o: boolean) => void; presetCustomer: string | null }) {
  const { org } = useOrg();
  const navigate = useNavigate();
  const customers = useCustomers();
  const [customer, setCustomer] = useState(presetCustomer ?? "");
  useEffect(() => setCustomer(presetCustomer ?? ""), [presetCustomer]);
  const create = async () => {
    if (!customer) return toast.error("Välj kund");
    const { data, error } = await supabase.from("orders").insert({ organization_id: org!.id, customer_id: customer }).select("id").single();
    if (error) return toast.error(errorMessage(error));
    onOpenChange(false);
    navigate(`/app/bestallningar/${data.id}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ny beställning" description="Kundens avtalade priser, rabatt och betalningsvillkor hämtas automatiskt."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={create} disabled={!customer}><ShoppingCart />Skapa order</Button></>}>
      <Field label="Kund"><Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
        <option value="">Välj kund…</option>
        {customers.data?.filter((c) => !c.anonymized_at && c.status !== "ended").map((c) => <option key={c.id} value={c.id}>{c.customer_number ? `${c.customer_number} – ` : ""}{c.name}</option>)}
      </Select></Field>
      {!customers.data?.length && <p className="mt-3 text-sm text-muted-foreground">Du har inga kunder ännu. <Link to="/app/kunder?ny=1" className="text-brand hover:underline">Skapa en kund</Link>.</p>}
    </Dialog>
  );
}

function AiOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { org, usage } = useOrg();
  const navigate = useNavigate();
  const customers = useCustomers();
  const ai = useAiTask();
  const [text, setText] = useState("");
  const [customer, setCustomer] = useState("");
  const [needsCustomer, setNeedsCustomer] = useState(false);
  const allowed = usage?.features.ai_orders !== false;
  const run = () => ai.mutate({ task: "order_draft", organization_id: org!.id, text, customer_id: customer || null }, {
    onSuccess: (r) => {
      const res = r as { order_id?: string | null; needs_customer?: boolean };
      if (res.needs_customer) { setNeedsCustomer(true); toast.info("AI kunde inte avgöra vilken kund det gäller – välj kund och försök igen."); return; }
      if (res.order_id) { toast.success("Orderutkast skapat – granska innan du bekräftar"); onOpenChange(false); setText(""); navigate(`/app/bestallningar/${res.order_id}`); }
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ny order med AI" className="max-w-xl"
      description="Klistra in kundens beställning, t.ex. ett mejl eller sms. AI hittar kund, artiklar, mängder och leveransdatum. Priserna hämtas alltid från prislistan och du godkänner innan något bekräftas."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={run} loading={ai.isPending} disabled={text.trim().length < 3 || !allowed}><Sparkles />Tolka beställningen</Button></>}>
      <div className="space-y-4">
        <Field label="Kundens beställning"><Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[160px]" placeholder={"Hej! Vi behöver 500 kg räkor packade till måndag, samt 2 pallar. Vår ref: PO-4471. /Eva, Fiskhandeln"} /></Field>
        <Field label={needsCustomer ? "Välj kund *" : "Kund (valfritt)"} hint="Lämna tomt så försöker AI hitta kunden i texten.">
          <Select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-invalid={needsCustomer && !customer || undefined}>
            <option value="">Låt AI avgöra</option>
            {customers.data?.filter((c) => !c.anonymized_at && c.status !== "ended").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!allowed && <p className="text-sm text-warning">AI-orderassistenten ingår inte i din plan.</p>}
      </div>
    </Dialog>
  );
}

function OrdersTab() {
  const [params, setParams] = useSearchParams();
  const orders = useOrders();
  const [q, setQ] = useState("");
  const status = (params.get("status") ?? "open") as (typeof FILTERS)[number]["id"];
  const match = (s: OrderStatus) => status === "all" || (status === "open" ? !["delivered", "cancelled"].includes(s) : s === status);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.id] = (orders.data ?? []).filter((o) => f.id === "all" || (f.id === "open" ? !["delivered", "cancelled"].includes(o.status) : o.status === f.id)).length;
    return c;
  }, [orders.data]);
  const list = (orders.data ?? []).filter((o) => match(o.status) && (!q.trim() ||
    [o.number, o.customers?.name, o.customer_reference, String(o.customers?.customer_number ?? "")].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))));
  return (
    <>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök ordernr, kund, referens…" className="pl-9" aria-label="Sök beställningar" />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={status === f.id} onClick={() => { const p = new URLSearchParams(params); p.set("status", f.id); setParams(p); }}
              className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition", status === f.id && "bg-surface text-foreground shadow-sm")}>
              {f.label}<span className="font-mono text-[11px] opacity-60">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {orders.isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        : !list.length ? <EmptyState icon={<ShoppingCart />} title={orders.data?.length ? "Inga beställningar i urvalet" : "Inga beställningar ännu"} description="Skapa en order manuellt, med AI från ett mejl, eller låt återkommande beställningar förbereda dem åt dig." />
        : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="divide-y md:hidden">
              {list.map((o) => (
                <Link key={o.id} to={`/app/bestallningar/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40">
                  <div className="min-w-0"><p className="font-mono text-xs">{o.number}</p><p className="truncate text-sm font-medium">{o.customers?.name}</p><p className="text-xs text-muted-foreground">{formatSEK(o.total)}{o.requested_delivery_date ? ` · lev. ${formatDate(o.requested_delivery_date)}` : ""}</p></div>
                  <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                </Link>
              ))}
            </div>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b bg-muted/40 text-left"><tr>{["Order", "Kund", "Status", "Källa", "Leverans", "Totalt"].map((h, i) => <th key={h} className={cn("label-mono px-4 py-3 font-normal", i === 5 && "text-right")}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className="group border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3.5"><Link to={`/app/bestallningar/${o.id}`} className="font-mono text-xs group-hover:text-brand">{o.number}</Link><p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p></td>
                    <td className="px-4 py-3.5"><Link to={`/app/bestallningar/${o.id}`} className="font-medium group-hover:text-brand">{o.customers?.name}</Link>{o.customer_reference && <p className="text-xs text-muted-foreground">Ref: {o.customer_reference}</p>}</td>
                    <td className="px-4 py-3.5"><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>{o.requires_manual_input && !["cancelled", "delivered"].includes(o.status) && <Badge tone="warning" className="ml-1.5">Pris saknas</Badge>}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.ai_generated && <Sparkles className="mr-1 inline size-3.5 text-brand" />}{ORDER_SOURCE[o.source]}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.requested_delivery_date ? formatDate(o.requested_delivery_date) : "–"}</td>
                    <td className="px-4 py-3.5 text-right font-mono tabular">{formatSEK(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

function RecurringTab() {
  const recurring = useRecurringOrders();
  const invalidate = useInvalidate();
  const toggle = async (id: string, status: "active" | "paused") => {
    const { error } = await supabase.from("recurring_orders").update({ status }).eq("id", id);
    if (error) return toast.error(errorMessage(error));
    toast.success(status === "paused" ? "Pausad" : "Återupptagen");
    invalidate("recurring");
  };
  if (recurring.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!recurring.data?.length) return <EmptyState icon={<Repeat />} title="Inga återkommande beställningar" description="Exempel: en kund som beställer 500 kg räkor varje måndag. Ordern förbereds automatiskt och väntar på ditt godkännande."
    action={<Button variant="brand" asChild><Link to="/app/bestallningar/aterkommande/ny"><Plus />Ny återkommande</Link></Button>} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="outline" asChild><Link to="/app/bestallningar/aterkommande/ny"><Plus />Ny återkommande</Link></Button></div>
      {recurring.data.map((r) => (
        <Card key={r.id} interactive className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Link to={`/app/bestallningar/aterkommande/${r.id}`} className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">{r.title}{r.status === "paused" && <Badge tone="warning">Pausad</Badge>}{r.status === "ended" && <Badge>Avslutad</Badge>}</p>
            <p className="text-xs text-muted-foreground">{r.customers?.name} · {describeSchedule({ frequency: r.frequency, interval: r.interval_count, weekdays: r.weekdays, dayOfMonth: r.day_of_month, startDate: r.start_date })}</p>
          </Link>
          <div className="flex items-center gap-3">
            {r.next_occurrence && <span className="text-sm text-muted-foreground">Nästa: <span className="font-medium text-foreground">{formatDate(r.next_occurrence, { weekday: "short", day: "numeric", month: "short" })}</span></span>}
            {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => toggle(r.id, "paused")}><Pause />Pausa</Button>}
            {r.status === "paused" && <Button size="sm" variant="outline" onClick={() => toggle(r.id, "active")}><Play />Återuppta</Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [aiOpen, setAiOpen] = useState(false);
  // Förbered återkommande order och påminnelser när sidan öppnas (idempotent)
  useEffect(() => {
    if (org) supabase.rpc("refresh_business", { org: org.id }).then(({ data }) => {
      if ((data as { generated_orders?: number } | null)?.generated_orders) invalidate("orders", "recurring", "tasks", "tasks-due-count");
    });
  }, [org]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = params.get("flik") === "aterkommande" ? "aterkommande" : "order";
  return (
    <div>
      <PageHeader title="Beställningar" description="Order med fasta priser från dina prislistor. Historiska priser bevaras alltid."
        actions={<><Button variant="outline" onClick={() => setAiOpen(true)}><Sparkles />Ny order med AI</Button><Button variant="brand" onClick={() => { const p = new URLSearchParams(params); p.set("ny", "1"); setParams(p); }}><Plus />Ny order</Button></>} />
      <Tabs value={tab} onValueChange={(v) => { const p = new URLSearchParams(params); if (v === "aterkommande") p.set("flik", "aterkommande"); else p.delete("flik"); setParams(p); }}>
        <TabsList><TabsTrigger value="order"><ShoppingCart />Beställningar</TabsTrigger><TabsTrigger value="aterkommande"><Repeat />Återkommande</TabsTrigger></TabsList>
        <TabsContent value="order"><OrdersTab /></TabsContent>
        <TabsContent value="aterkommande"><RecurringTab /></TabsContent>
      </Tabs>
      <NewOrderDialog open={params.get("ny") === "1"} presetCustomer={params.get("kund")} onOpenChange={(o) => { const p = new URLSearchParams(params); if (o) p.set("ny", "1"); else { p.delete("ny"); p.delete("kund"); } setParams(p); }} />
      <AiOrderDialog open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  );
}
