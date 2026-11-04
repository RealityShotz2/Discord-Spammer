import { useState } from "react";
import { toast } from "sonner";
import { BookOpen, HelpCircle, Lock, MapPin, Pencil, Plus, Scale, Sparkles, Tag, Trash2, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { UNITS } from "@/lib/labels";
import type { KnowledgeItem, PricingRule, Service } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { useInvalidate, useKnowledge, usePricingRules, useServices } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton, Switch } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";

const RULE_KINDS: Record<PricingRule["kind"], string> = {
  fixed_fee: "Fast avgift", minimum_charge: "Minimidebitering", discount_percent: "Rabatt (%)", surcharge_percent: "Tillägg (%)", note: "Notering",
};

function ServiceDialog({ service, open, onOpenChange }: { service: Partial<Service> | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { org, settings } = useOrg();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Partial<Service>>({});
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const cur = { unit: "st", vat_rate: settings?.default_vat_rate ?? 25, is_labor: false, active: true, ...service, ...f };

  const save = async () => {
    if (!cur.name?.trim()) return toast.error("Ange tjänstens namn");
    const p = price !== "" ? Number(price.replace(/\s/g, "").replace(",", ".")) : service?.unit_price ?? null;
    if (p !== null && (Number.isNaN(p) || p < 0)) return toast.error("Ogiltigt pris");
    setBusy(true);
    const row = { name: cur.name.trim(), description: cur.description || null, unit: cur.unit, unit_price: price === "" && !service?.id ? null : p, vat_rate: cur.vat_rate, is_labor: cur.is_labor, default_lead_time: cur.default_lead_time || null, active: cur.active };
    const { error } = service?.id
      ? await supabase.from("services").update(row).eq("id", service.id)
      : await supabase.from("services").insert({ ...row, organization_id: org!.id });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Tjänsten är sparad");
    invalidate("services");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setF({}); setPrice(""); } }} title={service?.id ? "Redigera tjänst" : "Ny tjänst"} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={save} loading={busy}>Spara</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Namn *" className="sm:col-span-2"><Input value={cur.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Plattsättning vägg" /></Field>
        <Field label="Beskrivning" hint="Hjälper AI:n att matcha förfrågningar." className="sm:col-span-2"><Textarea value={cur.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[72px]" /></Field>
        <Field label="Pris exkl. moms (kr)" hint="Lämna tomt om priset sätts per offert.">
          <Input inputMode="decimal" value={price !== "" ? price : service?.unit_price?.toString().replace(".", ",") ?? ""} onChange={(e) => setPrice(e.target.value)} placeholder="Manuellt pris" />
        </Field>
        <Field label="Enhet"><Select value={cur.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Field label="Moms"><Select value={cur.vat_rate} onChange={(e) => setF({ ...f, vat_rate: Number(e.target.value) })}>{[25, 12, 6, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</Select></Field>
        <Field label="Normal leveranstid"><Input value={cur.default_lead_time ?? ""} onChange={(e) => setF({ ...f, default_lead_time: e.target.value })} placeholder="2–3 veckor" /></Field>
        <label className="flex items-center justify-between rounded-xl border p-3 text-sm sm:col-span-2">
          <span><span className="font-medium">Arbetskostnad</span><span className="block text-xs text-muted-foreground">Kan ge ROT-avdrag för privatpersoner</span></span>
          <Switch label="Arbetskostnad" checked={!!cur.is_labor} onCheckedChange={(v) => setF({ ...f, is_labor: v })} />
        </label>
      </div>
    </Dialog>
  );
}

function ServicesTab({ admin }: { admin: boolean }) {
  const services = useServices();
  const invalidate = useInvalidate();
  const [edit, setEdit] = useState<Partial<Service> | null>(null);
  if (services.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">AI använder enbart dessa priser i offertutkast.</p>
        {admin && <Button variant="brand" onClick={() => setEdit({})}><Plus />Ny tjänst</Button>}
      </div>
      {!services.data?.length ? <EmptyState icon={<Wrench />} title="Inga tjänster ännu" description="Lägg till tjänster med priser så kan AI:n ta fram offertutkast." /> : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/40 text-left"><tr>{["Tjänst", "Pris", "Moms", "Leveranstid", "Aktiv", ""].map((h) => <th key={h} className="label-mono px-4 py-3 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {services.data.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><p className="font-medium">{s.name}</p>{s.description && <p className="line-clamp-1 text-xs text-muted-foreground">{s.description}</p>}<div className="mt-1 flex gap-1">{s.is_labor && <Badge>ROT</Badge>}</div></td>
                    <td className="px-4 py-3 font-mono tabular">{s.unit_price === null ? <Badge tone="warning">Manuellt</Badge> : `${formatSEK(s.unit_price)}/${s.unit}`}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.vat_rate} %</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.default_lead_time ?? "–"}</td>
                    <td className="px-4 py-3"><Switch label="Aktiv" disabled={!admin} checked={s.active} onCheckedChange={async (v) => { await supabase.from("services").update({ active: v }).eq("id", s.id); invalidate("services"); }} /></td>
                    <td className="px-4 py-3 text-right">{admin && <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="Redigera" onClick={() => setEdit(s)}><Pencil /></Button>
                      <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { if (!confirm(`Ta bort ${s.name}?`)) return; const { error } = await supabase.from("services").delete().eq("id", s.id); if (error) toast.error(errorMessage(error)); invalidate("services"); }}><Trash2 /></Button>
                    </div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ServiceDialog service={edit} open={!!edit} onOpenChange={(o) => !o && setEdit(null)} />
    </>
  );
}

function RulesTab({ admin }: { admin: boolean }) {
  const { org } = useOrg();
  const rules = usePricingRules();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ name: "", kind: "fixed_fee" as PricingRule["kind"], value: "", condition: "" });
  const add = async () => {
    if (!f.name.trim()) return toast.error("Ange ett namn");
    const value = f.kind === "note" ? null : Number(f.value.replace(",", "."));
    if (f.kind !== "note" && (Number.isNaN(value) || value! < 0)) return toast.error("Ange ett giltigt värde");
    const { error } = await supabase.from("pricing_rules").insert({ organization_id: org!.id, name: f.name.trim(), kind: f.kind, value, condition: f.condition || null });
    if (error) return toast.error(errorMessage(error));
    setF({ name: "", kind: "fixed_fee", value: "", condition: "" });
    invalidate("pricing_rules");
    toast.success("Prisregeln är sparad");
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Fasta avgifter läggs till som rader när villkoret uppfylls. Rabatter och tillägg föreslås bara – du bestämmer.</p>
        {rules.data?.length ? rules.data.map((r) => (
          <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><p className="text-sm font-medium">{r.name}</p><Badge>{RULE_KINDS[r.kind]}</Badge></div>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.value !== null && (r.kind.endsWith("percent") ? `${r.value} %` : formatSEK(r.value))}{r.condition && ` · ${r.condition}`}</p>
            </div>
            {admin && <div className="flex items-center gap-2">
              <Switch label="Aktiv" checked={r.active} onCheckedChange={async (v) => { await supabase.from("pricing_rules").update({ active: v }).eq("id", r.id); invalidate("pricing_rules"); }} />
              <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { await supabase.from("pricing_rules").delete().eq("id", r.id); invalidate("pricing_rules"); }}><Trash2 /></Button>
            </div>}
          </Card>
        )) : <EmptyState icon={<Scale />} title="Inga prisregler" description="T.ex. etableringsavgift, minimidebitering eller helgtillägg." />}
      </div>
      {admin && (
        <Card className="h-fit space-y-4 p-5">
          <h3 className="text-[15px] font-semibold tracking-tight">Ny prisregel</h3>
          <Field label="Namn"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Etableringsavgift" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Typ"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PricingRule["kind"] })}>{Object.entries(RULE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={f.kind.endsWith("percent") ? "Procent" : "Belopp (kr)"}><Input inputMode="decimal" disabled={f.kind === "note"} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          </div>
          <Field label="Villkor" hint="När gäller regeln? AI:n läser detta."><Textarea value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} className="min-h-[72px]" placeholder="Gäller alla uppdrag utanför Uppsala kommun" /></Field>
          <Button variant="brand" className="w-full" onClick={add}><Plus />Lägg till</Button>
        </Card>
      )}
    </div>
  );
}

const KNOWLEDGE_META: Record<KnowledgeItem["kind"], { title: string; empty: string; icon: typeof HelpCircle; titleLabel: string; placeholder: string }> = {
  faq: { title: "Vanliga frågor", empty: "Lägg till frågor kunder ofta ställer", icon: HelpCircle, titleLabel: "Fråga", placeholder: "Har ni F-skattsedel och försäkring?" },
  policy: { title: "Policyer", empty: "T.ex. betalningsvillkor, garantier och avbokning", icon: Scale, titleLabel: "Rubrik", placeholder: "Betalningsvillkor" },
  working_area: { title: "Arbetsområden", empty: "Var utför ni uppdrag?", icon: MapPin, titleLabel: "Område", placeholder: "Uppsala med omnejd" },
  instruction: { title: "AI-instruktioner", empty: "Egna instruktioner för hur AI:n ska skriva", icon: Sparkles, titleLabel: "Instruktion", placeholder: "Nämn alltid att vi erbjuder kostnadsfritt platsbesök" },
};

function KnowledgeTab({ kind, admin }: { kind: KnowledgeItem["kind"]; admin: boolean }) {
  const { org } = useOrg();
  const items = useKnowledge();
  const invalidate = useInvalidate();
  const meta = KNOWLEDGE_META[kind];
  const [f, setF] = useState({ title: "", content: "" });
  const list = (items.data ?? []).filter((i) => i.kind === kind);
  const add = async () => {
    if (!f.title.trim() || !f.content.trim()) return toast.error("Fyll i båda fälten");
    const { error } = await supabase.from("knowledge_items").insert({ organization_id: org!.id, kind, ...f });
    if (error) return toast.error(errorMessage(error));
    setF({ title: "", content: "" });
    invalidate("knowledge");
    toast.success("Sparat");
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {list.length ? list.map((i) => (
          <Card key={i.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-medium">{i.title}</p><p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{i.content}</p></div>
              {admin && <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { await supabase.from("knowledge_items").delete().eq("id", i.id); invalidate("knowledge"); }}><Trash2 /></Button>}
            </div>
          </Card>
        )) : <EmptyState icon={<meta.icon />} title={meta.empty} description="Allt här används av AI:n – och bara för ditt företag." />}
      </div>
      {admin && (
        <Card className="h-fit space-y-4 p-5">
          <h3 className="text-[15px] font-semibold tracking-tight">Lägg till</h3>
          <Field label={meta.titleLabel}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={meta.placeholder} /></Field>
          <Field label={kind === "faq" ? "Svar" : "Innehåll"}><Textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
          <Button variant="brand" className="w-full" onClick={add}><Plus />Spara</Button>
        </Card>
      )}
    </div>
  );
}

export default function Knowledge() {
  const { isAdmin } = useOrg();
  return (
    <div>
      <PageHeader title="Kunskapsbas" description="Det AI:n vet om ditt företag. Informationen används bara för ditt företag och blandas aldrig med andras."
        actions={!isAdmin ? <Badge><Lock className="size-3" />Endast administratörer kan ändra</Badge> : undefined} />
      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services"><Wrench />Tjänster & priser</TabsTrigger>
          <TabsTrigger value="rules"><Tag />Prisregler</TabsTrigger>
          <TabsTrigger value="faq"><HelpCircle />Vanliga frågor</TabsTrigger>
          <TabsTrigger value="policy"><BookOpen />Policyer</TabsTrigger>
          <TabsTrigger value="working_area"><MapPin />Arbetsområden</TabsTrigger>
          <TabsTrigger value="instruction"><Sparkles />AI-instruktioner</TabsTrigger>
        </TabsList>
        <TabsContent value="services"><ServicesTab admin={isAdmin} /></TabsContent>
        <TabsContent value="rules"><RulesTab admin={isAdmin} /></TabsContent>
        {(["faq", "policy", "working_area", "instruction"] as const).map((k) => <TabsContent key={k} value={k}><KnowledgeTab kind={k} admin={isAdmin} /></TabsContent>)}
      </Tabs>
    </div>
  );
}
