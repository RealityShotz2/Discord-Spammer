import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Plus, Search, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { CUSTOMER_STATUS } from "@/lib/labels";
import type { CustomerStatus } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { useCustomers } from "@/hooks/business";
import { useInvalidate } from "@/hooks/data";
import { useOrgId } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";

const FILTERS: { id: CustomerStatus | "all"; label: string }[] = [
  { id: "all", label: "Alla" }, { id: "active", label: "Aktiva" }, { id: "prospect", label: "Prospekt" }, { id: "paused", label: "Pausade" }, { id: "ended", label: "Avslutade" },
];

export function NewCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useOrgId();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ name: "", company_name: "", org_number: "", email: "", phone: "", customer_type: "company", status: "active", payment_terms_days: "30" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.name.trim()) return setError("Ange kundens namn.");
    if (f.org_number && !/^\d{6}-?\d{4}$/.test(f.org_number.trim())) return setError("Organisationsnumret ska ha formatet 556677-8899.");
    setBusy(true);
    const { data, error } = await supabase.from("customers").insert({
      organization_id: org, name: f.name.trim(), company_name: f.company_name || null, org_number: f.org_number.trim() || null,
      email: f.email.trim().toLowerCase() || null, phone: f.phone || null, customer_type: f.customer_type, status: f.status,
      payment_terms_days: Number(f.payment_terms_days) || 30,
    }).select("id").single();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    await invalidate("customers");
    toast.success("Kunden är skapad");
    onOpenChange(false);
    navigate(`/app/kunder/${data.id}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ny kund" description="Kundnummer tilldelas automatiskt." className="max-w-xl"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" type="submit" form="new-customer" loading={busy}>Skapa kund</Button></>}>
      <form id="new-customer" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Kundnamn *" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} autoFocus placeholder="Fiskhandeln i Göteborg AB" /></Field>
        <Field label="Typ"><Select value={f.customer_type} onChange={set("customer_type")}><option value="company">Företag</option><option value="private">Privatperson</option></Select></Field>
        <Field label="Organisationsnummer"><Input value={f.org_number} onChange={set("org_number")} placeholder="556677-8899" /></Field>
        <Field label="E-post"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Status"><Select value={f.status} onChange={set("status")}>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        <Field label="Betalningsvillkor (dagar)"><Input inputMode="numeric" value={f.payment_terms_days} onChange={set("payment_terms_days")} /></Field>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
      </form>
    </Dialog>
  );
}

export default function Customers() {
  const [params, setParams] = useSearchParams();
  const customers = useCustomers();
  const [q, setQ] = useState("");
  const status = (params.get("status") ?? "all") as CustomerStatus | "all";
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: customers.data?.filter((x) => !x.anonymized_at).length ?? 0 };
    for (const x of customers.data ?? []) if (!x.anonymized_at) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [customers.data]);
  const list = (customers.data ?? []).filter((c) => !c.anonymized_at && (status === "all" || c.status === status) && (!q.trim() ||
    [c.name, c.company_name, c.email, c.org_number, String(c.customer_number ?? "")].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))));

  return (
    <div>
      <PageHeader title="Kunder" description="Ditt kundregister med avtal, kontaktpersoner, priser och orderhistorik."
        actions={<Button variant="brand" onClick={() => setParams({ ny: "1" })}><Plus />Ny kund</Button>} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök namn, kundnummer, org.nr…" className="pl-9" aria-label="Sök kunder" />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={status === f.id} onClick={() => setParams(f.id === "all" ? {} : { status: f.id })}
              className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition", status === f.id && "bg-surface text-foreground shadow-sm")}>
              {f.label}<span className="font-mono text-[11px] opacity-60">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {customers.isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        : !list.length ? (
          <EmptyState icon={<Users />} title={customers.data?.length ? "Inga kunder matchar" : "Inga kunder ännu"}
            description="Kunder skapas automatiskt från förfrågningar, eller så lägger du till dem här." action={<Button variant="brand" onClick={() => setParams({ ny: "1" })}><Plus />Ny kund</Button>} />
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            {/* Mobil: kort */}
            <div className="divide-y md:hidden">
              {list.map((c) => (
                <Link key={c.id} to={`/app/kunder/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40">
                  <div className="min-w-0"><p className="truncate font-medium">{c.name}</p><p className="font-mono text-xs text-muted-foreground">#{c.customer_number}{c.email ? ` · ${c.email}` : ""}</p></div>
                  <Badge tone={CUSTOMER_STATUS[c.status].tone}>{CUSTOMER_STATUS[c.status].label}</Badge>
                </Link>
              ))}
            </div>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b bg-muted/40 text-left"><tr>{["Nr", "Kund", "Kontakt", "Status", "Betalningsvillkor", "Senast ändrad"].map((h) => <th key={h} className="label-mono px-4 py-3 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="group border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{c.customer_number}</td>
                    <td className="px-4 py-3.5"><Link to={`/app/kunder/${c.id}`} className="flex items-center gap-2 font-medium group-hover:text-brand">{c.customer_type === "company" && <Building2 className="size-3.5 text-muted-foreground" />}{c.name}</Link>{c.org_number && <p className="font-mono text-[11px] text-muted-foreground">{c.org_number}</p>}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{c.email ?? c.phone ?? "–"}</td>
                    <td className="px-4 py-3.5"><Badge tone={CUSTOMER_STATUS[c.status].tone}>{CUSTOMER_STATUS[c.status].label}</Badge></td>
                    <td className="px-4 py-3.5 text-muted-foreground">{c.payment_terms_days} dagar{c.discount_percent > 0 && <span className="ml-2 text-success">−{c.discount_percent} %</span>}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{relativeTime(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <NewCustomerDialog open={params.get("ny") === "1"} onOpenChange={(o) => setParams(o ? { ny: "1" } : {})} />
    </div>
  );
}
