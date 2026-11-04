import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Mail, Phone, XCircle } from "lucide-react";
import { callFunction, errorMessage } from "@/lib/api";
import { formatNumber, formatSEK } from "@shared/pricing.ts";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { LogoMark } from "@/components/layout/Logo";

interface View {
  quotation: { number: string; title: string; status: string; intro: string | null; project_description: string | null; delivery_timeframe: string | null; terms: string | null; valid_until: string | null; discount_type: string; discount_value: number; apply_rot: boolean; rot_percent: number; subtotal: number; discount_total: number; vat_total: number; total: number; rot_deduction: number; total_to_pay: number; sent_at: string; responded_at: string | null };
  items: { description: string; quantity: number; unit: string; unit_price: number; discount_percent: number; vat_rate: number; line_total: number; is_labor: boolean }[];
  customer: { name: string; company_name: string | null };
  organization: { name: string; org_number: string | null; email: string | null; phone: string | null; website: string | null; address: string | null; postal_code: string | null; city: string | null; brand_color: string | null };
}

export default function PublicQuote() {
  const { token = "" } = useParams();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | boolean>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["public-quote", token], retry: false, queryFn: () => callFunction<View>(`public-quote?token=${encodeURIComponent(token)}`, undefined, { method: "GET", auth: false }) });

  const respond = async (accepted: boolean) => {
    setBusy(accepted);
    setError(null);
    try {
      await callFunction("public-quote", { token, accepted, note: note || undefined }, { auth: false });
      await q.refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <div className="mx-auto max-w-3xl space-y-4 px-4 py-16"><Skeleton className="h-10 w-72" /><Skeleton className="h-96" /></div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-md px-6 py-24 text-center"><h1 className="text-xl font-semibold">Offerten hittades inte</h1><p className="mt-2 text-sm text-muted-foreground">Länken kan vara felaktig eller så har offerten dragits tillbaka.</p></div>;
  const { quotation: o, items, organization: org, customer } = q.data;
  const n = (v: unknown) => Number(v);
  const accent = org.brand_color ?? "#4f46e5";
  const expired = o.valid_until && new Date(o.valid_until) < new Date(new Date().toDateString());

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-3xl border bg-card shadow-sm animate-fade-up">
        <div className="h-1.5" style={{ background: accent }} />
        <header className="flex flex-col gap-6 border-b p-6 sm:flex-row sm:justify-between sm:p-10">
          <div>
            <p className="text-lg font-semibold tracking-tight">{org.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[org.address, [org.postal_code, org.city].filter(Boolean).join(" "), org.org_number && `Org.nr ${org.org_number}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="sm:text-right">
            <p className="label-mono">Offert {o.number}</p>
            <p className="mt-1 text-sm">Giltig till <span className="font-medium">{formatDate(o.valid_until)}</span></p>
            <div className="mt-2">
              {o.status === "accepted" ? <Badge tone="success">Accepterad</Badge> : o.status === "declined" ? <Badge tone="danger">Avböjd</Badge> : o.status === "expired" || expired ? <Badge>Utgången</Badge> : <Badge tone="brand">Väntar på ditt svar</Badge>}
            </div>
          </div>
        </header>

        <div className="space-y-8 p-6 sm:p-10">
          <div>
            <p className="label-mono">Till</p>
            <p className="mt-1 text-sm font-medium">{customer.company_name ? `${customer.company_name}, ` : ""}{customer.name}</p>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">{o.title}</h1>
            {o.intro && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{o.intro}</p>}
            {o.project_description && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{o.project_description}</p>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b text-left">{["Beskrivning", "Antal", "À-pris", "Summa"].map((h, i) => <th key={h} className={`label-mono pb-3 font-normal ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-3 pr-4">{it.description}{n(it.discount_percent) > 0 && <span className="text-xs text-muted-foreground"> (−{formatNumber(n(it.discount_percent))} %)</span>}</td>
                    <td className="py-3 text-right font-mono tabular">{formatNumber(n(it.quantity))} {it.unit}</td>
                    <td className="py-3 text-right font-mono tabular">{formatSEK(n(it.unit_price), { decimals: true })}</td>
                    <td className="py-3 text-right font-mono tabular">{formatSEK(n(it.line_total), { decimals: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Summa exkl. moms</dt><dd className="font-mono tabular">{formatSEK(n(o.subtotal), { decimals: true })}</dd></div>
            {n(o.discount_total) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Rabatt</dt><dd className="font-mono tabular">−{formatSEK(n(o.discount_total), { decimals: true })}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted-foreground">Moms</dt><dd className="font-mono tabular">{formatSEK(n(o.vat_total), { decimals: true })}</dd></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Totalt</dt><dd className="font-mono tabular">{formatSEK(n(o.total), { decimals: true })}</dd></div>
            {o.apply_rot && n(o.rot_deduction) > 0 && <>
              <div className="flex justify-between"><dt className="text-muted-foreground">Preliminärt ROT-avdrag</dt><dd className="font-mono tabular">−{formatSEK(n(o.rot_deduction), { decimals: true })}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Att betala</dt><dd className="font-mono tabular">{formatSEK(n(o.total_to_pay), { decimals: true })}</dd></div>
            </>}
          </dl>

          {(o.delivery_timeframe || o.terms) && (
            <div className="grid gap-6 border-t pt-8 sm:grid-cols-2">
              {o.delivery_timeframe && <div><p className="label-mono">Leveranstid</p><p className="mt-1.5 text-sm">{o.delivery_timeframe}</p></div>}
              {o.terms && <div><p className="label-mono">Villkor</p><p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{o.terms}</p></div>}
            </div>
          )}

          {o.status === "sent" && !expired ? (
            <div className="rounded-2xl border bg-muted/40 p-5">
              <p className="text-sm font-medium">Vill du gå vidare?</p>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Meddelande till företaget (valfritt)" className="mt-3 min-h-[72px] bg-surface" />
              {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => respond(false)} loading={busy === false}><XCircle />Tacka nej</Button>
                <Button variant="brand" onClick={() => respond(true)} loading={busy === true} style={{ background: accent }}><CheckCircle2 />Acceptera offerten</Button>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Genom att acceptera bekräftar du att du vill att {org.name} utför arbetet enligt offerten och dess villkor.</p>
            </div>
          ) : o.status === "accepted" ? (
            <p className="rounded-2xl border border-success/30 bg-success/10 p-5 text-sm">Tack! Du accepterade offerten {formatDate(o.responded_at)}. {org.name} hör av sig om nästa steg.</p>
          ) : o.status === "declined" ? (
            <p className="rounded-2xl border bg-muted/40 p-5 text-sm">Du tackade nej till offerten. Tack för att du hörde av dig!</p>
          ) : <p className="rounded-2xl border bg-muted/40 p-5 text-sm">Offertens giltighetstid har gått ut. Kontakta {org.name} för en ny offert.</p>}
        </div>

        <footer className="flex flex-col gap-3 border-t bg-muted/30 p-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <div className="flex flex-wrap gap-4">
            {org.email && <a href={`mailto:${org.email}`} className="flex items-center gap-1.5 hover:text-foreground"><Mail className="size-3.5" />{org.email}</a>}
            {org.phone && <a href={`tel:${org.phone}`} className="flex items-center gap-1.5 hover:text-foreground"><Phone className="size-3.5" />{org.phone}</a>}
          </div>
          <span className="flex items-center gap-1.5"><LogoMark className="size-4" />Skickad med Offertfabriken</span>
        </footer>
      </article>
    </div>
  );
}
