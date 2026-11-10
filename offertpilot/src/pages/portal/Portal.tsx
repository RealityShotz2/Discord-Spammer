import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2, Download, LogOut, Mail, Minus, Package, Phone, Plus, Repeat, Search, ShoppingCart, Tags } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { ORDER_STATUS } from "@/lib/labels";
import type { OrderStatus } from "@/lib/types";
import { formatNumber, formatSEK } from "@shared/pricing.ts";
import { normalizeCatalog, tierPrice, type CatalogItem } from "@shared/price-lists.ts";
import { cn, downloadBlob, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Access {
  customer_id: string; customer_name: string; customer_number: number | null; organization_id: string; organization_name: string;
  brand_color: string | null; logo_url: string | null; organization_email: string | null; organization_phone: string | null; can_order: boolean;
}
interface PortalOrder {
  id: string; number: string; status: OrderStatus; created_at: string; requested_delivery_date: string | null; delivery_date: string | null;
  customer_reference: string | null; notes_customer: string | null; subtotal: number; vat_total: number; total: number;
  items: { description: string; sku: string | null; quantity: number; unit: string; unit_price: number | null; line_total: number; price_list_item_id: string | null }[];
}

const FullPageLoader = () => <div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Laddar"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const parseQty = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** Inbjudningslänken från mejlet: skicka vidare till registreringen i portalläge. */
export function PortalRegisterRedirect() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  return <Navigate to={`/registrera?portal=1${email ? `&email=${encodeURIComponent(email)}` : ""}`} replace />;
}

function usePortalAccess(enabled: boolean) {
  return useQuery({
    queryKey: ["portal-access"],
    enabled,
    queryFn: async () => {
      await supabase.rpc("accept_portal_invitations");
      const { data, error } = await supabase.rpc("portal_access");
      if (error) throw error;
      return (data ?? []) as Access[];
    },
  });
}

function OrderTab({ access, catalog, onOrdered }: { access: Access; catalog: CatalogItem[]; onOrdered: () => void }) {
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, string>>({});
  const [delivery, setDelivery] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();
  const lines = catalog.map((c) => ({ c, qty: parseQty(cart[c.item_id] ?? "") })).filter((l) => l.qty > 0);
  const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * tierPrice(l.c, l.qty) * 100) / 100, 0);
  const vat = lines.reduce((s, l) => s + Math.round(l.qty * tierPrice(l.c, l.qty) * l.c.vat_rate) / 100, 0);
  const visible = catalog.filter((c) => !q.trim() || [c.name, c.sku, c.description].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())));
  const step = (id: string, d: number) => setCart((s) => { const n = Math.max(0, (parseQty(s[id] ?? "") || 0) + d); return { ...s, [id]: n ? String(n) : "" }; });

  const submit = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Lägg till minst en artikel");
      if (lines.some((l) => !Number.isFinite(l.qty) || l.qty > 1_000_000)) throw new Error("Kontrollera mängderna");
      const { data, error } = await supabase.rpc("portal_create_order", {
        cust: access.customer_id, items: lines.map((l) => ({ item_id: l.c.item_id, quantity: Math.round(l.qty * 1000) / 1000 })),
        requested_delivery_date: delivery || null, customer_reference: reference || null, notes: notes || null,
      });
      if (error) throw error;
      return data as { number: string };
    },
    onSuccess: (r) => {
      toast.success(`Tack! Beställning ${r.number} är skickad till ${access.organization_name} för bekräftelse.`);
      setCart({}); setDelivery(""); setReference(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      onOrdered();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!access.can_order) return <EmptyState icon={<ShoppingCart />} title="Beställningar är pausade" description={`Kontakta ${access.organization_name} för att lägga en beställning.`} />;
  if (!catalog.length) return <EmptyState icon={<Tags />} title="Inga artiklar ännu" description={`${access.organization_name} har inte lagt upp några priser för dig ännu.`} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök artikel eller artikelnummer…" className="pl-9" aria-label="Sök artiklar" />
        </div>
        <div className="divide-y overflow-hidden rounded-2xl border bg-card">
          {visible.map((c) => {
            const qty = parseQty(cart[c.item_id] ?? "");
            const price = qty > 0 ? tierPrice(c, qty) : c.unit_price;
            return (
              <div key={c.item_id} className={cn("flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center", qty > 0 && "bg-brand-soft/40")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{c.sku ? `${c.sku} · ` : ""}{formatSEK(price, { decimals: true })}/{c.unit} exkl. moms{c.tiers.length ? ` · mängdrabatt från ${formatNumber(c.tiers[0].min_quantity)} ${c.unit}` : ""}</p>
                  {c.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" aria-label={`Minska ${c.name}`} onClick={() => step(c.item_id, -1)} disabled={!(qty > 0)}><Minus /></Button>
                  <Input aria-label={`Mängd ${c.name}`} inputMode="decimal" value={cart[c.item_id] ?? ""} placeholder="0" onChange={(e) => setCart((s) => ({ ...s, [c.item_id]: e.target.value }))} className="h-9 w-20 text-center font-mono" />
                  <Button variant="outline" size="icon" aria-label={`Öka ${c.name}`} onClick={() => step(c.item_id, 1)}><Plus /></Button>
                  <span className="w-8 text-xs text-muted-foreground">{c.unit}</span>
                </div>
              </div>
            );
          })}
          {!visible.length && <p className="p-8 text-center text-sm text-muted-foreground">Inga artiklar matchar sökningen.</p>}
        </div>
      </div>
      <Card className="h-fit lg:sticky lg:top-6">
        <CardHeader title={<span className="flex items-center gap-2"><ShoppingCart className="size-4" />Din beställning</span>} />
        <CardBody className="space-y-4">
          {lines.length ? <ul className="space-y-1.5 text-sm">{lines.map((l) => <li key={l.c.item_id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{formatNumber(l.qty, 3)} {l.c.unit} {l.c.name}</span><span className="shrink-0 font-mono tabular">{formatSEK(Math.round(l.qty * tierPrice(l.c, l.qty) * 100) / 100, { decimals: true })}</span></li>)}</ul>
            : <p className="text-sm text-muted-foreground">Ange mängd på de artiklar du vill beställa.</p>}
          <dl className="space-y-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between"><dt>Summa exkl. moms</dt><dd className="font-mono tabular">{formatSEK(subtotal, { decimals: true })}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>Moms</dt><dd className="font-mono tabular">{formatSEK(vat, { decimals: true })}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Preliminärt totalt</dt><dd className="font-mono tabular">{formatSEK(subtotal + vat, { decimals: true })}</dd></div>
          </dl>
          <Field label="Önskat leveransdatum"><Input type="date" min={today()} value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
          <Field label="Er referens / inköpsnummer"><Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Meddelande"><Textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} className="min-h-[64px]" /></Field>
          <Button variant="brand" className="w-full" disabled={!lines.length} loading={submit.isPending} onClick={() => submit.mutate()}>Skicka beställning</Button>
          <p className="text-[11px] text-muted-foreground">Priserna är era avtalade priser och räknas om av {access.organization_name} vid bekräftelse. Beställningen är bindande först när den bekräftats.</p>
        </CardBody>
      </Card>
    </div>
  );
}

function OrdersTab({ access }: { access: Access }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ["portal-orders", access.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_orders", { cust: access.customer_id });
      if (error) throw error;
      return ((data ?? []) as PortalOrder[]).map((o) => ({ ...o, total: Number(o.total), subtotal: Number(o.subtotal), vat_total: Number(o.vat_total) }));
    },
  });
  const reorder = async (o: PortalOrder) => {
    setBusy(`re-${o.id}`);
    const { data, error } = await supabase.rpc("portal_reorder", { cust: access.customer_id, source_order: o.id });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    const r = data as { number: string; skipped: number };
    toast.success(`Beställning ${r.number} är skickad för bekräftelse${r.skipped ? ` (${r.skipped} rad${r.skipped > 1 ? "er" : ""} finns inte längre i prislistan)` : ""}.`);
    qc.invalidateQueries({ queryKey: ["portal-orders"] });
  };
  const pdf = async (o: PortalOrder) => {
    setBusy(`pdf-${o.id}`);
    try {
      const { data, error } = await supabase.rpc("portal_order_document", { cust: access.customer_id, oid: o.id });
      if (error) throw error;
      const [{ orderToPdf }, { renderQuotePdf }] = await Promise.all([import("@shared/order-data.ts"), import("@shared/quote-pdf.ts")]);
      downloadBlob(await renderQuotePdf(orderToPdf(data, { useBranding: false })) as BlobPart, `Orderbekraftelse-${o.number}.pdf`, "application/pdf");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  if (orders.isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  if (!orders.data?.length) return <EmptyState icon={<Package />} title="Inga beställningar ännu" description="Dina beställningar och deras status visas här." />;
  return (
    <div className="space-y-2.5">
      {orders.data.map((o) => {
        const st = ORDER_STATUS[o.status];
        const expanded = open === o.id;
        return (
          <Card key={o.id} className="overflow-hidden">
            <button className="flex w-full flex-col gap-2 p-4 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : o.id)}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium"><span className="font-mono text-sm">{o.number}</span><Badge tone={st.tone} dot>{st.label}</Badge></p>
                <p className="text-xs text-muted-foreground">Lagd {formatDate(o.created_at)}{o.requested_delivery_date ? ` · önskad leverans ${formatDate(o.requested_delivery_date)}` : ""}{o.delivery_date ? ` · levereras ${formatDate(o.delivery_date)}` : ""}</p>
              </div>
              <div className="flex items-center gap-3"><span className="font-mono text-sm tabular">{formatSEK(o.total, { decimals: true })}</span><ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} /></div>
            </button>
            {expanded && (
              <div className="border-t bg-muted/20 p-4">
                <ul className="space-y-1.5 text-sm">{o.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span className="min-w-0">{formatNumber(Number(i.quantity), 3)} {i.unit} {i.description}</span><span className="shrink-0 font-mono tabular">{formatSEK(Number(i.line_total), { decimals: true })}</span></li>)}</ul>
                <div className="mt-3 flex justify-between border-t pt-3 text-sm"><span>Varav moms</span><span className="font-mono tabular">{formatSEK(o.vat_total, { decimals: true })}</span></div>
                {o.notes_customer && <p className="mt-3 text-sm text-muted-foreground">{o.notes_customer}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {access.can_order && o.items.some((i) => i.price_list_item_id) && <Button size="sm" variant="brand" loading={busy === `re-${o.id}`} onClick={() => reorder(o)}><Repeat />Beställ igen</Button>}
                  {o.status !== "cancelled" && <Button size="sm" variant="outline" loading={busy === `pdf-${o.id}`} onClick={() => pdf(o)}><Download />{o.status === "pending_approval" ? "Beställningsunderlag (PDF)" : "Orderbekräftelse (PDF)"}</Button>}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function PricesTab({ catalog }: { catalog: CatalogItem[] }) {
  if (!catalog.length) return <EmptyState icon={<Tags />} title="Inga priser ännu" />;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b bg-muted/40 text-left"><tr>{["Artikel", "Enhet", "Pris exkl. moms", "Moms", "Mängdrabatt"].map((h) => <th key={h} className="label-mono px-4 py-3 font-normal">{h}</th>)}</tr></thead>
        <tbody>
          {catalog.map((c) => (
            <tr key={c.item_id} className="border-b last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{c.name}</p>{c.sku && <p className="font-mono text-[11px] text-muted-foreground">{c.sku}</p>}</td>
              <td className="px-4 py-3">{c.unit}</td>
              <td className="px-4 py-3 font-mono tabular">{formatSEK(c.unit_price, { decimals: true })}</td>
              <td className="px-4 py-3">{formatNumber(c.vat_rate)} %</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{c.tiers.length ? c.tiers.map((t) => `från ${formatNumber(t.min_quantity)} ${c.unit}: ${formatSEK(t.unit_price, { decimals: true })}`).join(" · ") : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Portal() {
  const { user, loading, signOut } = useAuth();
  const loc = useLocation();
  const access = usePortalAccess(!!user);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("bestall");
  const current = useMemo(() => access.data?.find((a) => a.customer_id === selected) ?? access.data?.[0], [access.data, selected]);
  const catalog = useQuery({
    queryKey: ["portal-catalog", current?.customer_id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_catalog", { cust: current!.customer_id });
      if (error) throw error;
      return normalizeCatalog(data ?? []);
    },
  });
  useEffect(() => { document.title = current ? `${current.organization_name} – Kundportal` : "Kundportal"; }, [current]);

  if (!supabaseConfigured) return <EmptyState title="Portalen är inte konfigurerad" />;
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to={`/logga-in?till=${encodeURIComponent(loc.pathname)}`} replace />;
  if (access.isLoading) return <FullPageLoader />;

  const brand = current?.brand_color && /^#[0-9a-f]{6}$/i.test(current.brand_color) ? current.brand_color : undefined;
  return (
    <div className="min-h-screen bg-background" style={brand ? ({ ["--portal-brand" as string]: brand } as React.CSSProperties) : undefined}>
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {current?.logo_url ? <img src={current.logo_url} alt="" className="size-9 rounded-lg object-contain" />
              : <span className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white" style={{ background: brand ?? "hsl(var(--brand))" }}>{(current?.organization_name ?? "K").slice(0, 1)}</span>}
            <div className="min-w-0"><p className="truncate font-semibold tracking-tight">{current?.organization_name ?? "Kundportal"}</p><p className="label-mono">Kundportal</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut()}><LogOut />Logga ut</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {!current ? (
          <EmptyState icon={<Package />} title="Inget kundkonto kopplat"
            description={`Vi hittade ingen aktiv inbjudan för ${user.email}. Kontrollera att du loggat in med adressen du blev inbjuden med och att du bekräftat din e-post, eller kontakta din leverantör.`}
            action={<Button variant="outline" asChild><Link to="/app">Till Offertfabriken</Link></Button>} />
        ) : (
          <>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="label-mono mb-2">Kundnummer {current.customer_number ?? "–"}</p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Välkommen, {current.customer_name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">Era avtalade priser, beställningar och orderbekräftelser.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {(access.data?.length ?? 0) > 1 && (
                  <select aria-label="Välj kundkonto" value={current.customer_id} onChange={(e) => setSelected(e.target.value)} className="h-9 rounded-lg border bg-surface px-3 text-sm">
                    {access.data!.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.organization_name} – {a.customer_name}</option>)}
                  </select>
                )}
                {current.organization_email && <a href={`mailto:${current.organization_email}`} className="inline-flex items-center gap-1.5 hover:text-foreground"><Mail className="size-4" />{current.organization_email}</a>}
                {current.organization_phone && <a href={`tel:${current.organization_phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground"><Phone className="size-4" />{current.organization_phone}</a>}
              </div>
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="bestall"><ShoppingCart />Beställ</TabsTrigger>
                <TabsTrigger value="order"><Package />Mina beställningar</TabsTrigger>
                <TabsTrigger value="priser"><Tags />Prislista</TabsTrigger>
              </TabsList>
              <TabsContent value="bestall">{catalog.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : <OrderTab key={current.customer_id} access={current} catalog={catalog.data ?? []} onOrdered={() => setTab("order")} />}</TabsContent>
              <TabsContent value="order"><OrdersTab access={current} /></TabsContent>
              <TabsContent value="priser"><PricesTab catalog={catalog.data ?? []} /></TabsContent>
            </Tabs>
          </>
        )}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">Kundportalen drivs av Offertfabriken. Du ser endast ditt eget företags uppgifter.</footer>
    </div>
  );
}
