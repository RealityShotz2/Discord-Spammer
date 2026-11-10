import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Ban, Building2, CalendarClock, Copy, FileText, KeyRound, Mail, Phone, Plus, Repeat, ShoppingCart, Star, Tags, Trash2, UserPlus,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import { ACTIVITY, AGREEMENT_STATUS, CUSTOMER_STATUS, ORDER_STATUS, QUOTE_STATUS } from "@/lib/labels";
import type { Agreement, BusinessCustomer, Contact } from "@/lib/types";
import { formatNumber, formatSEK } from "@shared/pricing.ts";
import { describeSchedule } from "@shared/schedule.ts";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { useCatalog, useCustomer, useOrders, usePriceLists, useRecurringOrders } from "@/hooks/business";
import { useInvalidate, useQuotations } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";

function OverviewTab({ c }: { c: BusinessCustomer }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState(c);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(c), [c]);
  const set = (k: keyof BusinessCustomer) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value === "" ? null : e.target.value } as BusinessCustomer);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("customers").update({
      name: f.name, company_name: f.company_name, org_number: f.org_number, customer_type: f.customer_type, status: f.status,
      email: f.email, invoice_email: f.invoice_email, phone: f.phone, address: f.address, postal_code: f.postal_code, city: f.city,
      delivery_address: f.delivery_address, delivery_postal_code: f.delivery_postal_code, delivery_city: f.delivery_city,
      payment_terms_days: Number(f.payment_terms_days), discount_percent: Number(String(f.discount_percent).replace(",", ".")) || 0, notes: f.notes,
    }).eq("id", c.id);
    setBusy(false);
    if (error) return toast.error(error.code === "23514" ? "Kontrollera organisationsnummer, e-post, rabatt (0–100 %) och betalningsvillkor." : errorMessage(error));
    toast.success("Kunduppgifterna är sparade");
    invalidate("customer", "customers");
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Företagsuppgifter" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Kundnamn"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Organisationsnummer"><Input value={f.org_number ?? ""} onChange={set("org_number")} placeholder="556677-8899" /></Field>
          <Field label="Typ"><Select value={f.customer_type} onChange={set("customer_type")}><option value="company">Företag</option><option value="private">Privatperson</option></Select></Field>
          <Field label="Status"><Select value={f.status} onChange={set("status")}>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="E-post"><Input type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
          <Field label="Faktura-e-post"><Input type="email" value={f.invoice_email ?? ""} onChange={set("invoice_email")} /></Field>
          <Field label="Telefon"><Input value={f.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Postadress"><Input value={f.address ?? ""} onChange={set("address")} /></Field>
          <div className="grid grid-cols-[.8fr_1.2fr] gap-3"><Field label="Postnr"><Input value={f.postal_code ?? ""} onChange={set("postal_code")} /></Field><Field label="Ort"><Input value={f.city ?? ""} onChange={set("city")} /></Field></div>
          <Field label="Leveransadress"><Input value={f.delivery_address ?? ""} onChange={set("delivery_address")} placeholder="Om annan än postadress" /></Field>
          <div className="grid grid-cols-[.8fr_1.2fr] gap-3"><Field label="Postnr"><Input value={f.delivery_postal_code ?? ""} onChange={set("delivery_postal_code")} /></Field><Field label="Ort"><Input value={f.delivery_city ?? ""} onChange={set("delivery_city")} /></Field></div>
          <Field label="Interna anteckningar" className="sm:col-span-2" hint="Visas aldrig för kunden."><Textarea value={f.notes ?? ""} onChange={set("notes")} /></Field>
        </CardBody>
        <div className="flex justify-end border-t px-5 py-3"><Button variant="brand" onClick={save} loading={busy}>Spara</Button></div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Villkor" description="Används som standard i nya order." />
        <CardBody className="space-y-4">
          <Field label="Betalningsvillkor (dagar)"><Input inputMode="numeric" value={String(f.payment_terms_days)} onChange={set("payment_terms_days")} /></Field>
          <Field label="Kundrabatt (%)" hint="Dras på hela ordern, utöver avtalade priser."><Input inputMode="decimal" value={String(f.discount_percent)} onChange={set("discount_percent")} /></Field>
          <Button variant="brand" className="w-full" onClick={save} loading={busy}>Spara villkor</Button>
        </CardBody>
      </Card>
    </div>
  );
}

function ContactsTab({ customer, contacts }: { customer: BusinessCustomer; contacts: Contact[] }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState({ name: "", role: "", email: "", phone: "" });
  const add = async () => {
    if (!f.name.trim()) return toast.error("Ange namn");
    const { error } = await supabase.from("customer_contacts").insert({ organization_id: customer.organization_id, customer_id: customer.id,
      name: f.name.trim(), role: f.role || null, email: f.email.trim().toLowerCase() || null, phone: f.phone || null, is_primary: contacts.length === 0 });
    if (error) return toast.error(errorMessage(error));
    setF({ name: "", role: "", email: "", phone: "" });
    invalidate("customer");
  };
  const makePrimary = async (id: string) => {
    await supabase.from("customer_contacts").update({ is_primary: false }).eq("customer_id", customer.id);
    await supabase.from("customer_contacts").update({ is_primary: true }).eq("id", id);
    invalidate("customer");
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3">
        {contacts.length ? contacts.map((p) => (
          <Card key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">{p.name}{p.is_primary && <Badge tone="brand"><Star className="size-3" />Primär</Badge>}</p>
              <p className="text-xs text-muted-foreground">{[p.role, p.email, p.phone].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex gap-1">
              {!p.is_primary && <Button size="sm" variant="ghost" onClick={() => makePrimary(p.id)}>Gör primär</Button>}
              <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { await supabase.from("customer_contacts").delete().eq("id", p.id); invalidate("customer"); }}><Trash2 /></Button>
            </div>
          </Card>
        )) : <EmptyState icon={<UserPlus />} title="Inga kontaktpersoner" description="Lägg till inköpare, ekonomi eller andra kontakter hos kunden." />}
      </div>
      <Card className="h-fit space-y-4 p-5">
        <h3 className="text-[15px] font-semibold tracking-tight">Ny kontaktperson</h3>
        <Field label="Namn"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Roll"><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Inköpare" /></Field>
        <Field label="E-post"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Button variant="brand" className="w-full" onClick={add}><Plus />Lägg till</Button>
      </Card>
    </div>
  );
}

function AgreementDialog({ customer, agreement, open, onOpenChange }: { customer: BusinessCustomer; agreement: Partial<Agreement> | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidate();
  const lists = usePriceLists();
  const [f, setF] = useState<Partial<Agreement>>({});
  useEffect(() => setF(agreement ?? {}), [agreement]);
  const today = new Date().toISOString().slice(0, 10);
  const cur = { title: "", start_date: today, end_date: null, notice_days: 30, auto_renew: false, renewal_months: 12, price_list_id: null, terms: "", status: "active", ...f } as Agreement;
  const save = async () => {
    if (!cur.title.trim()) return toast.error("Ange en rubrik för avtalet");
    const row = { title: cur.title.trim(), start_date: cur.start_date, end_date: cur.end_date || null, notice_days: Number(cur.notice_days), auto_renew: cur.auto_renew,
      renewal_months: Number(cur.renewal_months), price_list_id: cur.price_list_id || null, terms: cur.terms || null, status: cur.status };
    const { error } = cur.id ? await supabase.from("customer_agreements").update(row).eq("id", cur.id)
      : await supabase.from("customer_agreements").insert({ ...row, organization_id: customer.organization_id, customer_id: customer.id });
    if (error) return toast.error(error.code === "23514" ? "Slutdatum kan inte vara före startdatum." : errorMessage(error));
    toast.success("Avtalet är sparat");
    invalidate("customer", "catalog");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={cur.id ? "Redigera avtal" : "Nytt avtal"} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={save}>Spara</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rubrik *" className="sm:col-span-2"><Input value={cur.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ramavtal packning 2026" /></Field>
        <Field label="Startdatum"><Input type="date" value={cur.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Slutdatum" hint="Lämna tomt för tillsvidare."><Input type="date" value={cur.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} /></Field>
        <Field label="Påminn (dagar före slut)"><Input inputMode="numeric" value={String(cur.notice_days)} onChange={(e) => setF({ ...f, notice_days: Number(e.target.value) || 0 })} /></Field>
        <Field label="Status"><Select value={cur.status} onChange={(e) => setF({ ...f, status: e.target.value as Agreement["status"] })}>{Object.entries(AGREEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        <Field label="Prislista i avtalet" className="sm:col-span-2" hint="Kundspecifika prislistor gäller alltid; här kan du koppla en gemensam lista till avtalet.">
          <Select value={cur.price_list_id ?? ""} onChange={(e) => setF({ ...f, price_list_id: e.target.value || null })}>
            <option value="">Ingen särskild (standardlista)</option>
            {lists.data?.filter((l) => !l.customer_id || l.customer_id === customer.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <label className="flex items-center justify-between rounded-xl border p-3 text-sm sm:col-span-2">
          <span><span className="font-medium">Förlängs automatiskt</span><span className="block text-xs text-muted-foreground">Förlängs med {cur.renewal_months} månader i taget</span></span>
          <Switch label="Förlängs automatiskt" checked={cur.auto_renew} onCheckedChange={(v) => setF({ ...f, auto_renew: v })} />
        </label>
        <Field label="Villkor" className="sm:col-span-2"><Textarea value={cur.terms ?? ""} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

function AgreementsTab({ customer, agreements, admin }: { customer: BusinessCustomer; agreements: Agreement[]; admin: boolean }) {
  const [edit, setEdit] = useState<Partial<Agreement> | null>(null);
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Avtalshistorik – alla avtal sparas, även utgångna.</p>
        {admin && <Button variant="brand" onClick={() => setEdit({})}><Plus />Nytt avtal</Button>}
      </div>
      {agreements.length ? (
        <div className="space-y-3">
          {agreements.map((a) => {
            const days = a.end_date ? Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000) : null;
            return (
              <Card key={a.id} interactive={admin} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" onClick={() => admin && setEdit(a)}>
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">{a.title}<Badge tone={AGREEMENT_STATUS[a.status].tone}>{AGREEMENT_STATUS[a.status].label}</Badge>{a.auto_renew && <Badge>Förlängs automatiskt</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(a.start_date)} – {a.end_date ? formatDate(a.end_date) : "tillsvidare"}</p>
                </div>
                {a.status === "active" && days !== null && <span className={cn("text-sm", days <= a.notice_days ? "font-medium text-warning" : "text-muted-foreground")}>{days >= 0 ? `${days} dagar kvar` : "Har löpt ut"}</span>}
              </Card>
            );
          })}
        </div>
      ) : <EmptyState icon={<CalendarClock />} title="Inga avtal" description="Registrera avtalets start, slut och villkor så påminns du i tid inför förnyelse." />}
      <AgreementDialog customer={customer} agreement={edit} open={!!edit} onOpenChange={(o) => !o && setEdit(null)} />
    </>
  );
}

function PricesTab({ customer, admin }: { customer: BusinessCustomer; admin: boolean }) {
  const catalog = useCatalog(customer.id);
  const lists = usePriceLists();
  const navigate = useNavigate();
  const own = lists.data?.filter((l) => l.customer_id === customer.id) ?? [];
  const standard = lists.data?.find((l) => l.is_default);
  const createOwn = async () => {
    if (!standard) return toast.error("Skapa en standardprislista först under Prislistor");
    const { data, error } = await supabase.rpc("duplicate_price_list", { pl: standard.id, new_name: `${customer.name} – avtalspriser`, for_customer: customer.id });
    if (error) return toast.error(errorMessage(error));
    toast.success("Kundspecifik prislista skapad – justera priserna");
    navigate(`/app/prislistor/${data}`);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Gällande priser för kunden. Kundspecifika priser går före avtalets lista och standardlistan.</p>
        <div className="flex flex-wrap gap-2">
          {own.map((l) => <Button key={l.id} size="sm" variant="outline" asChild><Link to={`/app/prislistor/${l.id}`}><Tags />{l.name}</Link></Button>)}
          {admin && !own.length && <Button size="sm" variant="brand" onClick={createOwn}><Copy />Skapa kundspecifik prislista</Button>}
        </div>
      </div>
      {catalog.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : !catalog.data?.length ? (
        <EmptyState icon={<Tags />} title="Inga priser" description="Skapa en standardprislista under Prislistor eller en kundspecifik lista för den här kunden." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b bg-muted/40 text-left"><tr>{["Artikel", "Pris", "Mängdrabatt", "Moms", "Källa"].map((h) => <th key={h} className="label-mono px-4 py-3 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {catalog.data.map((i) => (
                <tr key={i.item_id} className="border-b last:border-0">
                  <td className="px-4 py-3"><p className="font-medium">{i.name}</p>{i.sku && <p className="font-mono text-[11px] text-muted-foreground">{i.sku}</p>}</td>
                  <td className="px-4 py-3 font-mono tabular">{formatSEK(i.unit_price, { decimals: true })}/{i.unit}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{i.tiers.length ? i.tiers.map((t) => `${formatNumber(t.min_quantity)}+ ${i.unit}: ${formatSEK(t.unit_price, { decimals: true })}`).join(" · ") : "–"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{i.vat_rate} %</td>
                  <td className="px-4 py-3">{i.customer_specific ? <Badge tone="brand">Kundpris</Badge> : <Badge>{i.price_list_name}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ customer }: { customer: BusinessCustomer }) {
  const orders = useOrders({ customerId: customer.id });
  const quotes = useQuotations();
  const recurring = useRecurringOrders({ customerId: customer.id });
  const ownQuotes = (quotes.data ?? []).filter((q) => q.customer_id === customer.id);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Beställningar" action={<Button size="sm" variant="ghost" asChild><Link to={`/app/bestallningar?ny=1&kund=${customer.id}`}><Plus />Ny order</Link></Button>} />
        <CardBody className="space-y-2">
          {orders.data?.length ? orders.data.slice(0, 20).map((o) => (
            <Link key={o.id} to={`/app/bestallningar/${o.id}`} className="flex items-center justify-between rounded-xl border p-3 transition hover:border-brand/30 hover:bg-muted/40">
              <div><p className="font-mono text-xs">{o.number}</p><p className="text-xs text-muted-foreground">{formatDate(o.created_at)} · {formatSEK(o.total)}</p></div>
              <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
            </Link>
          )) : <p className="py-2 text-sm text-muted-foreground">Inga beställningar ännu.</p>}
        </CardBody>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Återkommande beställningar" action={<Button size="sm" variant="ghost" asChild><Link to={`/app/bestallningar/aterkommande/ny?kund=${customer.id}`}><Plus />Ny</Link></Button>} />
          <CardBody className="space-y-2">
            {recurring.data?.length ? recurring.data.map((r) => (
              <Link key={r.id} to={`/app/bestallningar/aterkommande/${r.id}`} className="flex items-center justify-between rounded-xl border p-3 transition hover:bg-muted/40">
                <div><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{describeSchedule({ frequency: r.frequency, interval: r.interval_count, weekdays: r.weekdays, dayOfMonth: r.day_of_month, startDate: r.start_date })}</p></div>
                <span className="text-xs text-muted-foreground">{r.next_occurrence ? `Nästa ${formatDate(r.next_occurrence)}` : r.status === "paused" ? "Pausad" : "Avslutad"}</span>
              </Link>
            )) : <p className="py-2 text-sm text-muted-foreground">Inga återkommande beställningar.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Offerter" />
          <CardBody className="space-y-2">
            {ownQuotes.length ? ownQuotes.map((q) => (
              <Link key={q.id} to={`/app/offerter/${q.id}`} className="flex items-center justify-between rounded-xl border p-3 transition hover:bg-muted/40">
                <div className="flex items-center gap-3"><FileText className="size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{q.number}</p><p className="text-xs text-muted-foreground">{formatSEK(q.total)}</p></div></div>
                <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
              </Link>
            )) : <p className="py-2 text-sm text-muted-foreground">Inga offerter.</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function PortalTab({ customer, contacts, portalUsers }: { customer: BusinessCustomer; contacts: Contact[]; portalUsers: { id: string; email: string; accepted_at: string | null; disabled_at: string | null; invited_at: string }[] }) {
  const { settings, isAdmin } = useOrg();
  const invalidate = useInvalidate();
  const [email, setEmail] = useState(contacts.find((c) => c.is_primary)?.email ?? customer.email ?? "");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  if (!settings?.portal_enabled) {
    return <EmptyState icon={<KeyRound />} title="Kundportalen är avstängd" description="Slå på kundportalen så kan dina kunder se sina priser och beställa själva."
      action={isAdmin ? <Button variant="brand" asChild><Link to="/app/installningar/order">Gå till inställningar</Link></Button> : undefined} />;
  }
  const invite = async () => {
    setBusy(true);
    try {
      const res = await callFunction<{ demo: boolean; link?: string; message?: string }>("portal-invite", { customer_id: customer.id, email });
      if (res.demo) { setLink(res.link ?? null); toast.warning(res.message ?? "Demoläge"); } else toast.success(`Inbjudan skickad till ${email}`);
      invalidate("customer");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        {portalUsers.length ? portalUsers.map((p) => (
          <Card key={p.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{p.email}</p>
              <p className="text-xs text-muted-foreground">{p.disabled_at ? "Avstängd" : p.accepted_at ? `Aktiv sedan ${formatDate(p.accepted_at)}` : `Inbjuden ${relativeTime(p.invited_at)}`}</p></div>
            {p.disabled_at
              ? <Button size="sm" variant="outline" onClick={async () => { await supabase.from("customer_portal_users").update({ disabled_at: null }).eq("id", p.id); invalidate("customer"); }}>Återaktivera</Button>
              : <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await supabase.from("customer_portal_users").update({ disabled_at: new Date().toISOString() }).eq("id", p.id); toast.success("Åtkomsten är avstängd"); invalidate("customer"); }}><Ban />Stäng av</Button>}
          </Card>
        )) : <EmptyState icon={<KeyRound />} title="Ingen har portalåtkomst" description="Bjud in en kontaktperson så kan kunden se avtalade priser, beställa och ladda ner orderbekräftelser." />}
      </div>
      <Card className="h-fit space-y-4 p-5">
        <h3 className="text-[15px] font-semibold tracking-tight">Bjud in till kundportalen</h3>
        <p className="text-xs text-muted-foreground">Kunden ser bara sina egna priser och beställningar. Nya beställningar väntar på ditt godkännande.</p>
        <Field label="E-post"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} list="contact-emails" /></Field>
        <datalist id="contact-emails">{contacts.filter((c) => c.email).map((c) => <option key={c.id} value={c.email!}>{c.name}</option>)}</datalist>
        <Button variant="brand" className="w-full" onClick={invite} loading={busy} disabled={!email}><Mail />Skicka inbjudan</Button>
        {link && <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-xs"><code className="flex-1 truncate font-mono">{link}</code><Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(link); toast.success("Kopierad"); }}><Copy /></Button></div>}
      </Card>
    </div>
  );
}

function ActivityTab({ customerId }: { customerId: string }) {
  const { org } = useOrg();
  const q = useQuery({
    queryKey: ["customer-activity", customerId],
    queryFn: async () => {
      const { data: orderIds } = await supabase.from("orders").select("id").eq("customer_id", customerId).limit(200);
      const ids = [customerId, ...(orderIds ?? []).map((o) => o.id)];
      const { data } = await supabase.from("activity_logs").select("*").eq("organization_id", org!.id).in("entity_id", ids).order("created_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });
  if (!q.data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">Ingen aktivitet ännu.</p>;
  return (
    <Card><CardBody>
      <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[5px] before:w-px before:bg-border">
        {q.data.map((a) => (
          <li key={a.id} className="relative pl-6">
            <span className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-card bg-brand" />
            <p className="text-[13px] font-medium">{ACTIVITY[a.action] ?? a.action}</p>
            <p className="text-xs text-muted-foreground">{[a.details?.number, a.details?.title].filter(Boolean).join(" · ")}{(a.details?.number || a.details?.title) ? " · " : ""}{relativeTime(a.created_at)}</p>
          </li>
        ))}
      </ol>
    </CardBody></Card>
  );
}

export default function CustomerProfile() {
  const { id } = useParams();
  const { isAdmin } = useOrg();
  const data = useCustomer(id);
  if (data.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  if (!data.data) return <EmptyState title="Kunden hittades inte" action={<Button variant="outline" asChild><Link to="/app/kunder">Till kunder</Link></Button>} />;
  const { customer: c, contacts, agreements, portalUsers } = data.data;
  const active = agreements.find((a) => a.status === "active");
  return (
    <div>
      <Link to="/app/kunder" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Alla kunder</Link>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">Kund #{c.customer_number}</span>
            <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge>
            {active && <Badge tone="brand">Avtal till {active.end_date ? formatDate(active.end_date) : "tillsvidare"}</Badge>}
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{c.customer_type === "company" && <Building2 className="size-6 text-muted-foreground" />}{c.name}</h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-foreground"><Mail className="size-3.5" />{c.email}</a>}
            {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 hover:text-foreground"><Phone className="size-3.5" />{c.phone}</a>}
            <span>{c.payment_terms_days} dagars betalningsvillkor{c.discount_percent > 0 ? ` · ${c.discount_percent} % kundrabatt` : ""}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to={`/app/bestallningar/aterkommande/ny?kund=${c.id}`}><Repeat />Återkommande</Link></Button>
          <Button variant="brand" asChild><Link to={`/app/bestallningar?ny=1&kund=${c.id}`}><ShoppingCart />Ny order</Link></Button>
        </div>
      </div>
      <Tabs defaultValue="oversikt">
        <TabsList>
          <TabsTrigger value="oversikt">Översikt</TabsTrigger>
          <TabsTrigger value="kontakter">Kontakter <span className="font-mono text-[11px] opacity-60">{contacts.length}</span></TabsTrigger>
          <TabsTrigger value="avtal">Avtal <span className="font-mono text-[11px] opacity-60">{agreements.length}</span></TabsTrigger>
          <TabsTrigger value="priser">Priser</TabsTrigger>
          <TabsTrigger value="historik">Order & offerter</TabsTrigger>
          <TabsTrigger value="portal">Kundportal</TabsTrigger>
          <TabsTrigger value="aktivitet">Aktivitet</TabsTrigger>
        </TabsList>
        <TabsContent value="oversikt"><OverviewTab c={c} /></TabsContent>
        <TabsContent value="kontakter"><ContactsTab customer={c} contacts={contacts} /></TabsContent>
        <TabsContent value="avtal"><AgreementsTab customer={c} agreements={agreements} admin={isAdmin} /></TabsContent>
        <TabsContent value="priser"><PricesTab customer={c} admin={isAdmin} /></TabsContent>
        <TabsContent value="historik"><HistoryTab customer={c} /></TabsContent>
        <TabsContent value="portal"><PortalTab customer={c} contacts={contacts} portalUsers={portalUsers} /></TabsContent>
        <TabsContent value="aktivitet"><ActivityTab customerId={c.id} /></TabsContent>
      </Tabs>
    </div>
  );
}
