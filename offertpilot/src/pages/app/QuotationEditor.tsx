import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Download, Eye, History, Lock, Plus, RotateCcw, Send, ShieldCheck, Sparkles, Trash2, XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import { QUOTE_STATUS } from "@/lib/labels";
import type { Quotation, QuotationItem } from "@/lib/types";
import { computeTotals, formatNumber, formatSEK } from "@shared/pricing.ts";
import { cn, downloadBlob, formatDate, formatDateTime } from "@/lib/utils";
import { normItem, normQuote, useInvalidate, useServices } from "@/hooks/data";
import { useCatalog } from "@/hooks/business";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";

type Item = QuotationItem;
const VAT_RATES = [25, 12, 6, 0];
const parseNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));

function NumInput({ value, onCommit, disabled, placeholder, className, ariaLabel, invalid }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean; placeholder?: string; className?: string; ariaLabel: string; invalid?: boolean }) {
  const [v, setV] = useState(value === null ? "" : String(value).replace(".", ","));
  useEffect(() => setV(value === null ? "" : String(value).replace(".", ",")), [value]);
  return (
    <Input aria-label={ariaLabel} aria-invalid={invalid || undefined} inputMode="decimal" disabled={disabled} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = parseNum(v); if (n === null || !Number.isNaN(n)) { if (n !== value) onCommit(n); } else setV(value === null ? "" : String(value)); }}
      className={cn("h-9 text-right font-mono tabular", className)} />
  );
}

export default function QuotationEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, settings, usage } = useOrg();
  const invalidate = useInvalidate();
  const services = useServices();
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Partial<Quotation>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [respondOpen, setRespondOpen] = useState<null | boolean>(null);

  const q = useQuery({
    queryKey: ["quotation", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: quote, error }, { data: rows, error: e2 }] = await Promise.all([
        supabase.from("quotations").select("*, customers(id,name,email,company_name)").eq("id", id!).maybeSingle(),
        supabase.from("quotation_items").select("*").eq("quotation_id", id!).order("sort").order("created_at"),
      ]);
      if (error || e2) throw error ?? e2;
      return quote ? { quote: normQuote(quote as Quotation), items: (rows as Item[]).map(normItem) } : null;
    },
  });
  const versions = useQuery({
    queryKey: ["versions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("quotation_versions").select("id,version,reason,created_at").eq("quotation_id", id!).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (q.data) {
      setItems(q.data.items);
      setDraft(q.data.quote);
    }
  }, [q.data]);

  const quote = q.data?.quote;
  const editable = quote?.status === "draft";
  const catalog = useCatalog(editable ? quote?.customer_id : null);
  const totals = useMemo(() => computeTotals(items, {
    discount_type: (draft.discount_type ?? "none") as "none", discount_value: Number(draft.discount_value ?? 0),
    apply_rot: !!draft.apply_rot, rot_percent: Number(draft.rot_percent ?? 30),
  }), [items, draft.discount_type, draft.discount_value, draft.apply_rot, draft.rot_percent]);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>;
  if (!quote) return <EmptyState title="Offerten hittades inte" action={<Button variant="outline" asChild><Link to="/app/offerter">Till offerter</Link></Button>} />;

  const refresh = () => invalidate("quotation", "quotations", "versions", "lead", "leads", "dashboard", "tasks");

  const saveQuote = async (patch: Partial<Quotation>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const { error } = await supabase.from("quotations").update(patch).eq("id", quote.id);
    if (error) { toast.error(errorMessage(error)); refresh(); }
    else invalidate("quotation");
  };
  const saveItem = async (itemId: string, patch: Partial<Item>) => {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("quotation_items").update(patch).eq("id", itemId);
    if (error) { toast.error(errorMessage(error)); refresh(); }
    else invalidate("quotation");
  };
  const addItem = async (serviceId?: string) => {
    const s = services.data?.find((x) => x.id === serviceId);
    const { error } = await supabase.from("quotation_items").insert({
      organization_id: quote.organization_id, quotation_id: quote.id, service_id: s?.id ?? null, source: s ? "catalog" : "manual",
      description: s?.name ?? "Ny rad", quantity: 1, unit: s?.unit ?? "st", unit_price: s ? s.unit_price : null,
      vat_rate: s?.vat_rate ?? settings?.default_vat_rate ?? 25, is_labor: s?.is_labor ?? false, sort: items.length + 1,
    });
    if (error) return toast.error(errorMessage(error));
    refresh();
  };
  // Tillägg: rad från kundens fasta prislista (katalog och prisregler påverkas inte)
  const addFromPriceList = async (itemId: string) => {
    const c = catalog.data?.find((x) => x.item_id === itemId);
    if (!c) return;
    const { error } = await supabase.from("quotation_items").insert({
      organization_id: quote.organization_id, quotation_id: quote.id, service_id: null, source: "catalog",
      description: c.sku ? `${c.name} (${c.sku})` : c.name, quantity: 1, unit: c.unit, unit_price: c.unit_price,
      vat_rate: c.vat_rate, is_labor: false, sort: items.length + 1,
    });
    if (error) return toast.error(errorMessage(error));
    refresh();
  };
  const removeItem = async (itemId: string) => {
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    const { error } = await supabase.from("quotation_items").delete().eq("id", itemId);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  const rpc = async (name: string, label: string, success: string) => {
    setBusy(label);
    const { error } = await supabase.rpc(name, { qid: quote.id });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    toast.success(success);
    refresh();
  };

  const pdf = async (watermark: boolean) => {
    setBusy("pdf");
    try {
      const [{ loadQuoteBundle }, { renderQuotePdf }] = await Promise.all([import("@shared/quote-data.ts"), import("@shared/quote-pdf.ts")]);
      const bundle = await loadQuoteBundle(supabase, quote.id);
      const bytes = await renderQuotePdf({ ...bundle, useBranding: bundle.branding, draftWatermark: watermark });
      downloadBlob(bytes as BlobPart, `Offert-${quote.number}${watermark ? "-utkast" : ""}.pdf`, "application/pdf");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const link = quote.public_token ? `${window.location.origin}/offert/${quote.public_token}` : null;
  const st = QUOTE_STATUS[quote.status];
  const warnings = quote.ai_warnings ?? [];
  const missing = items.some((i) => i.unit_price === null);

  return (
    <div>
      <Link to={quote.lead_id ? `/app/leads/${quote.lead_id}` : "/app/offerter"} className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Tillbaka</Link>

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{quote.number} · v{quote.version}</span>
            <Badge tone={st.tone} dot>{st.label}</Badge>
            {quote.ai_generated && <Badge tone="brand"><Sparkles className="size-3" />AI-utkast</Badge>}
            {!editable && <Badge><Lock className="size-3" />Låst</Badge>}
          </div>
          {editable ? (
            <input aria-label="Offertens titel" defaultValue={quote.title} onBlur={(e) => e.target.value.trim() && e.target.value !== quote.title && saveQuote({ title: e.target.value.trim() })}
              className="w-full max-w-2xl rounded-lg bg-transparent text-2xl font-semibold tracking-tight outline-none transition hover:bg-muted/50 focus:bg-muted/50 sm:text-[28px]" />
          ) : <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{quote.title}</h1>}
          <p className="mt-1 text-sm text-muted-foreground">Till {quote.customers?.company_name ? `${quote.customers.company_name}, ` : ""}{quote.customers?.name} · Skapad {formatDate(quote.created_at)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && <Button variant="outline" onClick={() => pdf(true)} loading={busy === "pdf"}><Eye />Förhandsgranska</Button>}
          {!editable && <Button variant="outline" onClick={() => pdf(quote.status === "pending_approval")} loading={busy === "pdf"}><Download />PDF</Button>}
          {editable && !isAdmin && <Button variant="brand" onClick={() => rpc("submit_quotation", "submit", "Skickad för godkännande")} loading={busy === "submit"}><Send />Skicka för godkännande</Button>}
          {(editable || quote.status === "pending_approval") && isAdmin && (
            <Button variant="brand" disabled={missing} title={missing ? "Fyll i alla priser först" : undefined} onClick={() => rpc("approve_quotation", "approve", "Offerten är godkänd")} loading={busy === "approve"}><ShieldCheck />Godkänn offert</Button>
          )}
          {quote.status === "approved" && <Button variant="brand" onClick={() => setSendOpen(true)}><Send />Skicka till kund</Button>}
          {quote.status === "sent" && <>
            <Button variant="outline" onClick={() => setRespondOpen(false)}><XCircle />Avböjd</Button>
            <Button variant="brand" onClick={() => setRespondOpen(true)}><CheckCircle2 />Accepterad</Button>
          </>}
        </div>
      </div>

      {quote.status === "pending_approval" && !isAdmin && (
        <Notice tone="warning" icon={<Lock />}>Offerten väntar på godkännande av en administratör. Den kan inte ändras eller skickas under tiden.</Notice>
      )}
      {missing && editable && (
        <Notice tone="warning" icon={<AlertTriangle />}>En eller flera rader saknar pris. AI sätter aldrig egna priser – fyll i dem innan offerten kan godkännas.</Notice>
      )}
      {quote.status === "accepted" && <Notice tone="success" icon={<CheckCircle2 />}>Kunden accepterade offerten {formatDateTime(quote.responded_at)}.{quote.customer_response_note && <> Meddelande: ”{quote.customer_response_note}”</>}</Notice>}
      {quote.status === "declined" && <Notice tone="danger" icon={<XCircle />}>Kunden avböjde offerten {formatDateTime(quote.responded_at)}.{quote.customer_response_note && <> Meddelande: ”{quote.customer_response_note}”</>}</Notice>}
      {link && quote.status === "sent" && (
        <Notice tone="brand" icon={<Send />}>
          Skickad {formatDateTime(quote.sent_at)}. Kundens länk:{" "}
          <button className="inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:underline" onClick={() => { navigator.clipboard.writeText(link); toast.success("Länken är kopierad"); }}>
            {link.replace(/^https?:\/\//, "").slice(0, 42)}…<Copy className="size-3" />
          </button>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {warnings.length > 0 && (
            <Card className="border-warning/30">
              <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" />Att granska från AI</span>} description="Kontrollera dessa punkter innan du godkänner." />
              <CardBody><ul className="space-y-2 text-sm">{warnings.map((w, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />{w}</li>)}</ul></CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Offertrader" description="Priser exkl. moms. Rader från katalogen hämtar ditt pris automatiskt."
              action={editable ? (
                <div className="flex gap-2">
                  <Select aria-label="Lägg till från katalog" className="h-9 w-48 text-[13px]" value="" onChange={(e) => e.target.value && addItem(e.target.value)}>
                    <option value="">Från katalog…</option>
                    {services.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  {!!catalog.data?.length && (
                    <Select aria-label="Lägg till från prislista" className="h-9 w-48 text-[13px]" value="" onChange={(e) => e.target.value && addFromPriceList(e.target.value)}>
                      <option value="">Från prislista…</option>
                      {catalog.data.map((c) => <option key={c.item_id} value={c.item_id}>{c.name} · {formatSEK(c.unit_price, { decimals: true })}/{c.unit}</option>)}
                    </Select>
                  )}
                  <Button size="sm" variant="outline" onClick={() => addItem()}><Plus />Rad</Button>
                </div>
              ) : null} />
            <CardBody className="overflow-x-auto px-0 pb-2">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {["Beskrivning", "Antal", "Enhet", "À-pris", "Rabatt %", "Moms", "ROT", "Summa", ""].map((h, i) => <th key={i} className={cn("label-mono px-3 pb-3 font-normal first:pl-5", i >= 1 && i <= 7 && i !== 2 && i !== 5 && i !== 6 && "text-right")}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b align-top last:border-0">
                      <td className="min-w-[240px] py-2.5 pl-5 pr-3">
                        {editable ? <Input aria-label="Beskrivning" defaultValue={it.description} onBlur={(e) => e.target.value !== it.description && saveItem(it.id, { description: e.target.value })} className="h-9" /> : <p className="pt-1.5">{it.description}</p>}
                        {it.ai_reason && <p className="mt-1 text-[11.5px] text-muted-foreground"><Sparkles className="mr-1 inline size-3 text-brand" />{it.ai_reason}</p>}
                      </td>
                      <td className="w-[90px] px-2 py-2.5">{editable ? <NumInput ariaLabel="Antal" value={it.quantity} onCommit={(v) => v && v > 0 && saveItem(it.id, { quantity: v })} /> : <p className="pt-1.5 text-right font-mono">{formatNumber(it.quantity)}</p>}</td>
                      <td className="w-[86px] px-2 py-2.5">{editable ? <Input aria-label="Enhet" defaultValue={it.unit} onBlur={(e) => e.target.value !== it.unit && saveItem(it.id, { unit: e.target.value || "st" })} className="h-9" /> : <p className="pt-1.5">{it.unit}</p>}</td>
                      <td className="w-[120px] px-2 py-2.5">{editable ? <NumInput ariaLabel="À-pris" value={it.unit_price} placeholder="Pris saknas" invalid={it.unit_price === null} onCommit={(v) => saveItem(it.id, { unit_price: v })} /> : <p className="pt-1.5 text-right font-mono">{formatSEK(it.unit_price, { decimals: true })}</p>}</td>
                      <td className="w-[86px] px-2 py-2.5">{editable ? <NumInput ariaLabel="Rabatt" value={it.discount_percent} onCommit={(v) => saveItem(it.id, { discount_percent: Math.min(100, Math.max(0, v ?? 0)) })} /> : <p className="pt-1.5 text-right font-mono">{formatNumber(it.discount_percent)}</p>}</td>
                      <td className="w-[86px] px-2 py-2.5">{editable ? (
                        <Select aria-label="Moms" className="h-9 text-[13px]" value={it.vat_rate} onChange={(e) => saveItem(it.id, { vat_rate: Number(e.target.value) })}>{VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}</Select>
                      ) : <p className="pt-1.5">{formatNumber(it.vat_rate)} %</p>}</td>
                      <td className="w-[52px] px-2 py-2.5 text-center"><input type="checkbox" aria-label="Arbetskostnad (ROT)" disabled={!editable} checked={it.is_labor} onChange={(e) => saveItem(it.id, { is_labor: e.target.checked })} className="mt-2.5 accent-[hsl(var(--brand))]" /></td>
                      <td className="w-[120px] px-3 py-2.5 text-right font-mono tabular"><p className="pt-1.5">{it.unit_price === null ? <span className="text-warning">–</span> : formatSEK(Math.round(it.quantity * it.unit_price * (1 - it.discount_percent / 100) * 100) / 100, { decimals: true })}</p></td>
                      <td className="w-[44px] py-2.5 pr-4">{editable && <Button variant="ghost" size="icon" aria-label="Ta bort rad" onClick={() => removeItem(it.id)}><Trash2 /></Button>}</td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">Inga rader ännu. Lägg till från katalogen eller skapa en egen rad.</td></tr>}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Innehåll och villkor" />
            <CardBody className="grid gap-5 md:grid-cols-2">
              <Field label="Inledning" className="md:col-span-2"><Textarea disabled={!editable} defaultValue={quote.intro ?? ""} onBlur={(e) => e.target.value !== (quote.intro ?? "") && saveQuote({ intro: e.target.value || null })} className="min-h-[72px]" placeholder="Tack för din förfrågan! Här är vårt förslag…" /></Field>
              <Field label="Projektbeskrivning" className="md:col-span-2"><Textarea disabled={!editable} defaultValue={quote.project_description ?? ""} onBlur={(e) => e.target.value !== (quote.project_description ?? "") && saveQuote({ project_description: e.target.value || null })} /></Field>
              <Field label="Beräknad leveranstid" hint="Ange bara tider ni kan hålla."><Input disabled={!editable} defaultValue={quote.delivery_timeframe ?? ""} onBlur={(e) => e.target.value !== (quote.delivery_timeframe ?? "") && saveQuote({ delivery_timeframe: e.target.value || null })} placeholder="Start v. 12, cirka 3 veckor" /></Field>
              <Field label="Giltig till"><Input type="date" disabled={!editable} defaultValue={quote.valid_until ?? ""} onBlur={(e) => e.target.value && e.target.value !== quote.valid_until && saveQuote({ valid_until: e.target.value })} /></Field>
              <Field label="Villkor" className="md:col-span-2"><Textarea disabled={!editable} defaultValue={quote.terms ?? ""} onBlur={(e) => e.target.value !== (quote.terms ?? "") && saveQuote({ terms: e.target.value || null })} placeholder="Betalning 30 dagar netto. Tillkommande arbeten debiteras löpande…" /></Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-6">
            <CardHeader title="Summering" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select aria-label="Rabattyp" disabled={!editable} value={draft.discount_type ?? "none"} onChange={(e) => saveQuote({ discount_type: e.target.value as Quotation["discount_type"], ...(e.target.value === "none" ? { discount_value: 0 } : {}) })} className="h-9 text-[13px]">
                  <option value="none">Ingen rabatt</option><option value="percent">Rabatt i procent</option><option value="amount">Rabatt i kronor</option>
                </Select>
                <NumInput ariaLabel="Rabatt" className="w-24" disabled={!editable || draft.discount_type === "none"} value={Number(draft.discount_value ?? 0)} onCommit={(v) => saveQuote({ discount_value: Math.max(0, v ?? 0) })} />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">ROT-avdrag</p>
                  <p className="text-[11.5px] text-muted-foreground">På rader markerade som arbete</p>
                </div>
                <div className="flex items-center gap-2">
                  {draft.apply_rot && <NumInput ariaLabel="ROT-procent" className="h-8 w-16" disabled={!editable} value={Number(draft.rot_percent ?? settings?.rot_percent ?? 30)} onCommit={(v) => saveQuote({ rot_percent: Math.min(100, Math.max(0, v ?? 0)) })} />}
                  <Switch label="ROT-avdrag" disabled={!editable} checked={!!draft.apply_rot} onCheckedChange={(v) => saveQuote({ apply_rot: v, rot_percent: Number(draft.rot_percent ?? settings?.rot_percent ?? 30) })} />
                </div>
              </div>

              <dl className="space-y-2.5 border-t pt-4 text-sm">
                <Row k="Summa exkl. moms" v={formatSEK(totals.subtotal, { decimals: true })} />
                {totals.discount_total > 0 && <Row k="Rabatt" v={`−${formatSEK(totals.discount_total, { decimals: true })}`} />}
                {totals.vat_breakdown.filter((b) => b.rate > 0).map((b) => <Row key={b.rate} k={`Moms ${formatNumber(b.rate)} %`} v={formatSEK(b.vat, { decimals: true })} muted />)}
                <Row k="Totalt inkl. moms" v={formatSEK(totals.total, { decimals: true })} strong />
                {draft.apply_rot && <>
                  <Row k={`ROT-avdrag ${formatNumber(Number(draft.rot_percent ?? 30))} %`} v={`−${formatSEK(totals.rot_deduction, { decimals: true })}`} />
                  <Row k="Att betala" v={formatSEK(totals.total_to_pay, { decimals: true })} strong />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">Preliminärt. ROT-avdraget är max 50 000 kr per person och år och förutsätter att kunden har utrymme hos Skatteverket.</p>
                </>}
              </dl>
              {editable && <p className="text-[11px] text-muted-foreground">Summorna räknas om och verifieras på servern vid varje ändring.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><History className="size-4" />Versioner</span>} />
            <CardBody className="space-y-2.5">
              {versions.data?.length ? versions.data.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-[13px]">
                  <span><span className="font-mono text-xs text-muted-foreground">v{v.version}</span> {({ submitted: "Inskickad", approved: "Godkänd", sent: "Skickad" } as Record<string, string>)[v.reason] ?? v.reason}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(v.created_at)}</span>
                </div>
              )) : <p className="text-sm text-muted-foreground">Ingen version sparad ännu. En ögonblicksbild sparas vid inskick, godkännande och utskick.</p>}
            </CardBody>
          </Card>

          <div className="flex flex-col gap-2">
            {["pending_approval", "approved", "sent", "declined", "expired"].includes(quote.status) && (isAdmin || quote.status === "pending_approval") && (
              <Button variant="ghost" onClick={() => rpc("reopen_quotation", "reopen", "Offerten är öppnad för ändringar")} loading={busy === "reopen"}><RotateCcw />Öppna för ändring (ny version)</Button>
            )}
            {quote.status === "approved" && <Button variant="ghost" onClick={() => rpc("mark_quotation_sent", "mark", "Markerad som skickad – uppföljningar är schemalagda")} loading={busy === "mark"}><Check />Markera som skickad manuellt</Button>}
            {editable && <Button variant="ghost" className="text-destructive" onClick={async () => {
              if (!confirm("Radera utkastet?")) return;
              const { error } = await supabase.from("quotations").delete().eq("id", quote.id);
              if (error) return toast.error(errorMessage(error));
              toast.success("Utkastet raderades");
              refresh();
              navigate(quote.lead_id ? `/app/leads/${quote.lead_id}` : "/app/offerter");
            }}><Trash2 />Radera utkast</Button>}
          </div>
        </div>
      </div>

      <SendDialog open={sendOpen} onOpenChange={setSendOpen} quote={quote} total={totals} hasBranding={!!usage?.features.branding} onDone={refresh} onDownload={() => pdf(false)} />
      <Dialog open={respondOpen !== null} onOpenChange={(o) => !o && setRespondOpen(null)} title={respondOpen ? "Markera som accepterad" : "Markera som avböjd"}
        description="Använd detta om kunden svarat via telefon eller e-post. Uppföljningarna för offerten stoppas."
        footer={<><Button variant="ghost" onClick={() => setRespondOpen(null)}>Avbryt</Button><Button variant={respondOpen ? "brand" : "destructive"} onClick={async () => {
          const note = (document.getElementById("resp-note") as HTMLTextAreaElement | null)?.value;
          const { error } = await supabase.rpc("record_quotation_response", { qid: quote.id, accepted: !!respondOpen, note: note || null });
          if (error) return toast.error(errorMessage(error));
          toast.success(respondOpen ? "Grattis till affären!" : "Offerten markerad som avböjd");
          setRespondOpen(null);
          refresh();
        }}>Bekräfta</Button></>}>
        <Field label="Anteckning (valfritt)"><Textarea id="resp-note" placeholder={respondOpen ? "Start bekräftad till vecka 14" : "Valde annan leverantör på grund av pris"} /></Field>
      </Dialog>
    </div>
  );
}

function Row({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "border-t pt-2.5 text-[15px] font-semibold", muted && "text-muted-foreground")}>
      <dt>{k}</dt><dd className="font-mono tabular">{v}</dd>
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: "warning" | "success" | "danger" | "brand"; icon: React.ReactNode; children: React.ReactNode }) {
  const t = { warning: "border-warning/30 bg-warning/10 text-warning", success: "border-success/30 bg-success/10 text-success", danger: "border-destructive/30 bg-destructive/10 text-destructive", brand: "border-brand/25 bg-brand-soft text-brand" }[tone];
  return <div className={cn("mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", t)}>{icon}<div className="text-foreground/90">{children}</div></div>;
}

function SendDialog({ open, onOpenChange, quote, total, onDone, onDownload }: { open: boolean; onOpenChange: (o: boolean) => void; quote: Quotation; total: ReturnType<typeof computeTotals>; hasBranding: boolean; onDone: () => void; onDownload: () => void }) {
  const first = quote.customers?.name?.split(" ")[0] ?? "";
  const [subject, setSubject] = useState(`Offert ${quote.number}`);
  const [message, setMessage] = useState(`Hej ${first}!\n\nTack för din förfrågan. Här kommer vår offert "${quote.title}" på totalt ${formatSEK(total.total, { decimals: true })} inkl. moms${quote.apply_rot ? ` (${formatSEK(total.total_to_pay, { decimals: true })} efter preliminärt ROT-avdrag)` : ""}. Offerten finns bifogad som PDF.\n\nDu kan även se och svara på offerten direkt via länken i mejlet.\n\nVänliga hälsningar`);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    try {
      const res = await callFunction<{ demo?: boolean; message?: string; sent?: boolean }>("send-quotation", { quotation_id: quote.id, subject, message });
      if (res.demo) setDemo(res.message ?? "Demoläge");
      else { toast.success("Offerten är skickad till kunden"); onOpenChange(false); onDone(); }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setDemo(null); }} title="Skicka offert" description={`Till ${quote.customers?.email ?? "kunden saknar e-post"}`} className="max-w-xl"
      footer={demo ? (
        <><Button variant="outline" onClick={onDownload}><Download />Ladda ner PDF</Button><Button variant="brand" onClick={async () => {
          const { error } = await supabase.rpc("mark_quotation_sent", { qid: quote.id });
          if (error) return toast.error(errorMessage(error));
          toast.success("Markerad som skickad – uppföljningar är schemalagda");
          onOpenChange(false); onDone();
        }}><Check />Jag har skickat den – markera som skickad</Button></>
      ) : (
        <><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={send} loading={busy} disabled={!quote.customers?.email}><Send />Skicka</Button></>
      )}>
      {demo ? (
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><p>{demo}</p></div>
      ) : (
        <div className="space-y-4">
          <Field label="Ämne"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Meddelande" hint="PDF och en länk där kunden kan acceptera eller avböja bifogas automatiskt."><Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[220px]" /></Field>
        </div>
      )}
    </Dialog>
  );
}
