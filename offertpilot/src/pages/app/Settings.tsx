import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, CreditCard, Download, Lock, Mail, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import { INDUSTRIES } from "@/lib/labels";
import type { Organization, OrgSettings } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { cn, downloadBlob, formatDate } from "@/lib/utils";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, PageHeader, Skeleton, Switch } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { passwordValid } from "../auth/AuthLayout";

const TABS = [
  ["foretag", "Företag"], ["team", "Team"], ["ai", "AI-beteende"], ["offert", "Offert & priser"], ["uppfoljning", "Uppföljning"],
  ["epost", "E-post"], ["aviseringar", "Aviseringar"], ["sakerhet", "Säkerhet & data"], ["fakturering", "Fakturering"],
] as const;

function Section({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
      {footer && <div className="flex justify-end border-t px-5 py-3">{footer}</div>}
    </Card>
  );
}

function AdminOnly() {
  return <p className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground"><Lock className="size-4" />Endast administratörer kan ändra dessa inställningar.</p>;
}

function useSettingsForm() {
  const { settings, refresh, isAdmin } = useOrg();
  const [s, setS] = useState<OrgSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const save = async (keys: (keyof OrgSettings)[]) => {
    if (!s) return;
    setBusy(true);
    const patch = Object.fromEntries(keys.map((k) => [k, s[k]]));
    const { error } = await supabase.from("organization_settings").update(patch).eq("organization_id", s.organization_id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Inställningarna är sparade");
    refresh();
  };
  return { s, setS, save, busy, isAdmin };
}

function CompanyTab() {
  const { org, refresh, isAdmin, usage } = useOrg();
  const [f, setF] = useState<Organization | null>(org);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(org), [org]);
  if (!f) return null;
  const set = (k: keyof Organization) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });
  const save = async () => {
    setBusy(true);
    const { id, public_form_key, created_at, ...rest } = f;
    void public_form_key; void created_at;
    const { error } = await supabase.from("organizations").update({
      name: rest.name, org_number: rest.org_number, industry: rest.industry, email: rest.email, phone: rest.phone, website: rest.website,
      address: rest.address, postal_code: rest.postal_code, city: rest.city, description: rest.description, pricing_model: rest.pricing_model,
      communication_style: rest.communication_style, brand_color: rest.brand_color, logo_url: rest.logo_url,
    }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.code === "23514" ? "Kontrollera organisationsnummer, färgkod (#RRGGBB) och logotypens adress (https://)." : errorMessage(error));
    toast.success("Företagsprofilen är sparad");
    refresh();
  };
  return (
    <div className="space-y-6">
      {!isAdmin && <AdminOnly />}
      <Section title="Företagsprofil" description="Visas i offerter och används av AI:n." footer={isAdmin && <Button variant="brand" onClick={save} loading={busy}>Spara</Button>}>
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Företagsnamn"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Organisationsnummer"><Input value={f.org_number ?? ""} onChange={set("org_number")} placeholder="556677-8899" /></Field>
          <Field label="Bransch"><Select value={f.industry ?? ""} onChange={set("industry")}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select></Field>
          <Field label="Webbplats"><Input value={f.website ?? ""} onChange={set("website")} /></Field>
          <Field label="E-post"><Input value={f.email ?? ""} onChange={set("email")} /></Field>
          <Field label="Telefon"><Input value={f.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Adress"><Input value={f.address ?? ""} onChange={set("address")} /></Field>
          <div className="grid grid-cols-[.8fr_1.2fr] gap-3"><Field label="Postnr"><Input value={f.postal_code ?? ""} onChange={set("postal_code")} /></Field><Field label="Ort"><Input value={f.city ?? ""} onChange={set("city")} /></Field></div>
          <Field label="Beskrivning" className="sm:col-span-2"><Textarea value={f.description ?? ""} onChange={set("description")} /></Field>
          <Field label="Prismodell" className="sm:col-span-2"><Input value={f.pricing_model ?? ""} onChange={set("pricing_model")} /></Field>
        </fieldset>
      </Section>
      <Section title="Varumärke" description={usage?.features.branding ? "Används i PDF-offerter och e-post." : "Egen profilfärg i offerter ingår i Professional."}>
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Profilfärg" hint="Hex-kod, t.ex. #4F46E5">
            <div className="flex gap-2"><input type="color" aria-label="Välj färg" value={f.brand_color ?? "#4f46e5"} onChange={(e) => setF({ ...f, brand_color: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border bg-transparent" /><Input value={f.brand_color ?? ""} onChange={set("brand_color")} placeholder="#4F46E5" /></div>
          </Field>
          <Field label="Logotyp (URL)" hint="Måste börja med https://"><Input value={f.logo_url ?? ""} onChange={set("logo_url")} placeholder="https://…" /></Field>
        </fieldset>
      </Section>
    </div>
  );
}

function TeamTab() {
  const { org, isAdmin, usage } = useOrg();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "admin">("employee");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const members = useQuery({ queryKey: ["members", org?.id], queryFn: async () => (await supabase.from("organization_members").select("*").eq("organization_id", org!.id).order("created_at")).data ?? [] });
  const invites = useQuery({ queryKey: ["invites", org?.id], enabled: isAdmin, queryFn: async () => (await supabase.from("organization_invitations").select("*").eq("organization_id", org!.id).is("accepted_at", null).order("created_at")).data ?? [] });

  const invite = async () => {
    setBusy(true);
    try {
      const res = await callFunction<{ demo: boolean; link?: string; message?: string }>("team-invite", { organization_id: org!.id, email, role });
      if (res.demo) { setLink(res.link ?? null); toast.warning(res.message ?? "Demoläge"); } else toast.success(`Inbjudan skickad till ${email}`);
      setEmail("");
      invites.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast.error(errorMessage(error));
    toast.success(msg);
    members.refetch();
  };

  return (
    <div className="space-y-6">
      <Section title="Medlemmar" description={`${members.data?.length ?? 0} av ${usage?.max_users ?? "–"} platser används i ${usage?.plan_name ?? "din plan"}.`}>
        <div className="divide-y">
          {members.data?.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium">{m.full_name ?? m.email}{m.user_id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(du)</span>}</p><p className="text-xs text-muted-foreground">{m.email}</p></div>
              <div className="flex items-center gap-2">
                {isAdmin && m.user_id !== user?.id ? (
                  <>
                    <Select aria-label="Roll" value={m.role} onChange={(e) => act("set_member_role", { org: org!.id, member_user: m.user_id, new_role: e.target.value }, "Rollen är ändrad")} className="h-9 w-40 text-[13px]">
                      <option value="admin">Administratör</option><option value="employee">Medarbetare</option>
                    </Select>
                    <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={() => confirm("Ta bort medlemmen?") && act("remove_member", { org: org!.id, member_user: m.user_id }, "Medlemmen är borttagen")}><Trash2 /></Button>
                  </>
                ) : <Badge tone={m.role === "admin" ? "brand" : "neutral"}>{m.role === "admin" ? "Administratör" : "Medarbetare"}</Badge>}
              </div>
            </div>
          ))}
        </div>
      </Section>
      {isAdmin && (
        <Section title="Bjud in kollega" description="Medarbetare kan hantera leads och skapa offerter. Bara administratörer kan godkänna offerter och ändra inställningar.">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <Input type="email" placeholder="kollega@foretag.se" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-post" />
            <Select value={role} onChange={(e) => setRole(e.target.value as "employee")} aria-label="Roll"><option value="employee">Medarbetare</option><option value="admin">Administratör</option></Select>
            <Button variant="brand" onClick={invite} loading={busy} disabled={!email}><UserPlus />Bjud in</Button>
          </div>
          {link && <div className="mt-3 flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-xs"><code className="flex-1 truncate font-mono">{link}</code><Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(link); toast.success("Kopierad"); }}><Copy />Kopiera</Button></div>}
          {!!invites.data?.length && (
            <div className="mt-5 space-y-2">
              <p className="label-mono">Väntande inbjudningar</p>
              {invites.data.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                  <span>{i.email} <span className="text-xs text-muted-foreground">· gäller till {formatDate(i.expires_at)}</span></span>
                  <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("organization_invitations").delete().eq("id", i.id); invites.refetch(); }}>Återkalla</Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function AiTab() {
  const { s, setS, save, busy, isAdmin } = useSettingsForm();
  if (!s) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      {!isAdmin && <AdminOnly />}
      <Section title="Tonläge och instruktioner" description="Styr hur AI:n formulerar sig. Säkerhetsreglerna (inga påhittade priser, inga utskick utan godkännande) kan inte ändras."
        footer={isAdmin && <Button variant="brand" loading={busy} onClick={() => save(["ai_tone", "ai_custom_instructions"])}>Spara</Button>}>
        <fieldset disabled={!isAdmin} className="grid gap-4">
          <Field label="Tonläge"><Input value={s.ai_tone} onChange={(e) => setS({ ...s, ai_tone: e.target.value })} /></Field>
          <Field label="Egna instruktioner" hint="Max 4 000 tecken. Fler instruktioner kan läggas till i Kunskapsbasen."><Textarea value={s.ai_custom_instructions ?? ""} onChange={(e) => setS({ ...s, ai_custom_instructions: e.target.value })} className="min-h-[140px]" placeholder="Använd du-tilltal. Erbjud alltid ett kostnadsfritt platsbesök vid renoveringar." /></Field>
        </fieldset>
      </Section>
      <Section title="Så skyddas din data">
        <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          {["AI:n ser bara ditt företags data, isolerat per organisation i databasen.", "Instruktioner i kundmeddelanden behandlas som data och kan inte styra AI:n.", "Priser hämtas alltid från din katalog – aldrig från AI:n.", "Alla AI-svar valideras mot ett schema innan de sparas."].map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" />{x}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function QuoteTab() {
  const { s, setS, save, busy, isAdmin } = useSettingsForm();
  if (!s) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      {!isAdmin && <AdminOnly />}
      <Section title="Offertinställningar" footer={isAdmin && <Button variant="brand" loading={busy} onClick={() => save(["default_vat_rate", "quote_validity_days", "quote_number_prefix", "rot_percent", "quote_intro", "quote_terms", "quote_footer"])}>Spara</Button>}>
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Standardmoms"><Select value={s.default_vat_rate} onChange={(e) => setS({ ...s, default_vat_rate: Number(e.target.value) })}>{[25, 12, 6, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</Select></Field>
          <Field label="Giltighetstid (dagar)"><Input type="number" min={1} max={365} value={s.quote_validity_days} onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })} /></Field>
          <Field label="Prefix för offertnummer" hint="Versaler, siffror och bindestreck"><Input value={s.quote_number_prefix} onChange={(e) => setS({ ...s, quote_number_prefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="ROT-procent" hint="Kontrollera aktuell nivå hos Skatteverket"><Input type="number" min={0} max={100} value={s.rot_percent} onChange={(e) => setS({ ...s, rot_percent: Number(e.target.value) })} /></Field>
          <Field label="Standardinledning" className="sm:col-span-2"><Textarea value={s.quote_intro ?? ""} onChange={(e) => setS({ ...s, quote_intro: e.target.value })} className="min-h-[72px]" /></Field>
          <Field label="Standardvillkor" className="sm:col-span-2"><Textarea value={s.quote_terms ?? ""} onChange={(e) => setS({ ...s, quote_terms: e.target.value })} placeholder="Betalning 30 dagar netto. Priserna gäller under förutsättning att…" /></Field>
          <Field label="Sidfot i PDF" className="sm:col-span-2"><Input value={s.quote_footer ?? ""} onChange={(e) => setS({ ...s, quote_footer: e.target.value })} placeholder="Godkänd för F-skatt · Bankgiro 123-4567" /></Field>
        </fieldset>
      </Section>
    </div>
  );
}

function FollowUpTab() {
  const { s, setS, save, busy, isAdmin } = useSettingsForm();
  const [days, setDays] = useState("");
  useEffect(() => { if (s) setDays(s.follow_up_rules.quote_followup_days.join(", ")); }, [s?.organization_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Skeleton className="h-64" />;
  const r = s.follow_up_rules;
  return (
    <div className="space-y-6">
      {!isAdmin && <AdminOnly />}
      <Section title="Uppföljningsregler" description="Påminnelser skapas automatiskt. Meddelanden skickas alltid först efter ditt godkännande."
        footer={isAdmin && <Button variant="brand" loading={busy} onClick={() => {
          const parsed = days.split(/[,\s]+/).filter(Boolean).map(Number);
          if (parsed.some((d) => !Number.isInteger(d) || d < 1 || d > 90) || parsed.length > 6) return toast.error("Ange upp till 6 heltal mellan 1 och 90");
          s.follow_up_rules = { ...r, quote_followup_days: parsed };
          save(["follow_up_rules"]);
        }}>Spara</Button>}>
        <fieldset disabled={!isAdmin} className="grid gap-5 sm:grid-cols-2">
          <Field label="Påminn om obesvarad förfrågan efter (timmar)"><Input type="number" min={1} max={168} value={r.lead_response_hours} onChange={(e) => setS({ ...s, follow_up_rules: { ...r, lead_response_hours: Number(e.target.value) } })} /></Field>
          <Field label="Följ upp skickad offert efter (dagar)" hint="Kommaseparerat, t.ex. 3, 7, 14"><Input value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-4 sm:col-span-2">
            <div><p className="text-sm font-medium">Automatiska utskick</p><p className="text-xs text-muted-foreground">Kontrollerad automatisk sändning kommer i en senare version. Idag godkänns varje meddelande manuellt.</p></div>
            <Switch label="Automatiska utskick" checked={false} disabled onCheckedChange={() => {}} />
          </div>
        </fieldset>
      </Section>
    </div>
  );
}

function EmailTab() {
  const { s, setS, save, busy, isAdmin } = useSettingsForm();
  if (!s) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      {!isAdmin && <AdminOnly />}
      <Section title="Avsändare" description="Gäller offerter, svar och uppföljningar som skickas från Offertfabriken." footer={isAdmin && <Button variant="brand" loading={busy} onClick={() => save(["email_from_name", "email_reply_to"])}>Spara</Button>}>
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Avsändarnamn"><Input value={s.email_from_name ?? ""} onChange={(e) => setS({ ...s, email_from_name: e.target.value })} /></Field>
          <Field label="Svarsadress (reply-to)" hint="Kundens svar hamnar här"><Input type="email" value={s.email_reply_to ?? ""} onChange={(e) => setS({ ...s, email_reply_to: e.target.value })} /></Field>
        </fieldset>
      </Section>
      <Section title="Teknisk konfiguration">
        <p className="flex gap-2.5 text-sm text-muted-foreground"><Mail className="mt-0.5 size-4 shrink-0" />Själva e-postleveransen konfigureras av systemadministratören med <code className="font-mono text-xs">RESEND_API_KEY</code> och <code className="font-mono text-xs">EMAIL_FROM</code> (verifierad domän). Utan dessa körs demoläge och inget skickas.</p>
      </Section>
    </div>
  );
}

function NotificationsTab() {
  const { s, setS, save, busy, isAdmin } = useSettingsForm();
  if (!s) return <Skeleton className="h-64" />;
  const n = s.notifications;
  const rows: [keyof typeof n, string, string][] = [
    ["new_lead_email", "Ny förfrågan", "E-post till företagets adress när en förfrågan kommer via formuläret"],
    ["quote_response_email", "Kundsvar på offert", "När en kund accepterar eller avböjer (kommer snart)"],
    ["daily_digest", "Daglig sammanfattning", "Översikt över leads och uppföljningar (kommer snart)"],
  ];
  return (
    <Section title="Aviseringar" footer={isAdmin && <Button variant="brand" loading={busy} onClick={() => save(["notifications"])}>Spara</Button>}>
      <div className="divide-y">
        {rows.map(([k, title, desc]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
            <Switch label={title} disabled={!isAdmin} checked={!!n[k]} onCheckedChange={(v) => setS({ ...s, notifications: { ...n, [k]: v } })} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function SecurityTab() {
  const { org, isAdmin } = useOrg();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const changePw = async () => {
    if (!passwordValid(pw)) return toast.error("Minst 10 tecken med stora och små bokstäver samt siffror.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    setPw("");
    toast.success("Lösenordet är ändrat");
  };
  const exportAll = async () => {
    const { data, error } = await supabase.rpc("export_organization_data", { org: org!.id });
    if (error) return toast.error(errorMessage(error));
    downloadBlob(JSON.stringify(data, null, 2), `offertfabriken-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    toast.success("Exporten är nedladdad");
  };
  return (
    <div className="space-y-6">
      <Section title="Lösenord">
        <div className="flex flex-col gap-3 sm:flex-row"><Input type="password" autoComplete="new-password" placeholder="Nytt lösenord" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Nytt lösenord" /><Button onClick={changePw} loading={busy}>Byt lösenord</Button></div>
      </Section>
      <Section title="Dataportabilitet (GDPR)" description="Exportera all data för företaget i maskinläsbart format. Export för enskilda kunder finns på varje lead.">
        <Button variant="outline" onClick={exportAll} disabled={!isAdmin}><Download />Exportera all data (JSON)</Button>
        {!isAdmin && <p className="mt-2 text-xs text-muted-foreground">Kräver administratörsbehörighet.</p>}
      </Section>
      <Section title="Aktivitetslogg" description="Alla viktiga händelser loggas med användare och tidpunkt: godkännanden, utskick, AI-anrop, rolländringar och dataraderingar. Senaste händelserna visas på Översikt och ingår i exporten.">
        <p className="text-sm text-muted-foreground">Loggen kan inte ändras eller raderas av användare.</p>
      </Section>
      {isAdmin && (
        <Card className="border-destructive/30">
          <CardHeader title="Radera företaget" description="Raderar permanent företaget och all tillhörande data: kunder, leads, offerter och historik." />
          <CardBody><Button variant="destructive" onClick={() => setDelOpen(true)}><Trash2 />Radera företag</Button></CardBody>
        </Card>
      )}
      <Dialog open={delOpen} onOpenChange={setDelOpen} title="Radera företaget permanent?" description={`Skriv företagsnamnet “${org?.name}” för att bekräfta. Exportera gärna din data först.`}
        footer={<><Button variant="ghost" onClick={() => setDelOpen(false)}>Avbryt</Button><Button variant="destructive" disabled={confirmName !== org?.name} onClick={async () => {
          const { error } = await supabase.rpc("delete_organization", { org: org!.id, confirm_name: confirmName });
          if (error) return toast.error(errorMessage(error));
          try { localStorage.removeItem("op-org"); } catch { /* ignoreras */ }
          toast.success("Företaget är raderat");
          navigate("/kom-igang");
          window.location.reload();
        }}>Radera permanent</Button></>}>
        <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={org?.name} aria-label="Bekräfta företagsnamn" />
      </Dialog>
    </div>
  );
}

function BillingTab() {
  const { org, usage, isAdmin } = useOrg();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const plans = useQuery({ queryKey: ["plans"], queryFn: async () => (await supabase.from("plans").select("*").order("sort")).data ?? [] });
  useEffect(() => {
    if (params.get("status") === "klar") toast.success("Tack! Prenumerationen aktiveras inom kort.");
  }, [params]);
  const go = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await callFunction<{ url?: string; demo?: boolean; message?: string }>("billing", { organization_id: org!.id, ...body });
      if (res.demo) toast.warning(res.message ?? "Betalningar är inte aktiverade");
      else if (res.url) window.location.href = res.url;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const statusLabel: Record<string, string> = { trialing: "Provperiod", active: "Aktiv", past_due: "Betalning saknas", canceled: "Avslutad", incomplete: "Ofullständig" };
  const FEATURES: Record<string, string[]> = {
    starter: ["1 användare", "30 AI-assisterade leads/mån", "Offertgenerering", "Grundläggande översikt"],
    professional: ["Upp till 5 användare", "150 AI-assisterade leads/mån", "AI-skrivna uppföljningar", "Analys och diagram", "Egen profilfärg i offerter"],
    business: ["Upp till 25 användare", "600 AI-assisterade leads/mån", "Avancerade arbetsflöden", "Teamsamarbete", "Prioriterad support", "Fler integrationer"],
  };
  return (
    <div className="space-y-6">
      {usage && (
        <Card className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="label-mono">Nuvarande plan</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{usage.plan_name} <Badge tone={usage.active ? "success" : "danger"} className="ml-2 align-middle">{statusLabel[usage.status] ?? usage.status}</Badge></p>
              <p className="mt-1 text-sm text-muted-foreground">{usage.status === "trialing" && usage.trial_ends_at ? `Provperioden slutar ${formatDate(usage.trial_ends_at)}.` : usage.current_period_end ? `Förnyas ${formatDate(usage.current_period_end)}.` : ""} {usage.ai_leads_used} av {usage.max_ai_leads} AI-leads använda denna månad.</p>
            </div>
            {isAdmin && <Button variant="outline" onClick={() => go({ action: "portal" }, "portal")} loading={busy === "portal"}><CreditCard />Hantera betalning</Button>}
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.data?.map((p) => {
          const current = usage?.plan_id === p.id;
          return (
            <Card key={p.id} className={cn("flex flex-col p-6", p.id === "professional" && "border-brand/40 shadow-[0_12px_40px_-16px_hsl(var(--brand)/0.4)]")}>
              <div className="flex items-center justify-between"><p className="font-semibold">{p.name}</p>{p.id === "professional" && <Badge tone="brand">Populärast</Badge>}</div>
              <p className="mt-4"><span className="text-3xl font-semibold tracking-tight">{formatSEK(p.price_sek)}</span><span className="text-sm text-muted-foreground"> /mån exkl. moms</span></p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">{(FEATURES[p.id] ?? []).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{f}</li>)}</ul>
              <Button className="mt-6" variant={current ? "outline" : p.id === "professional" ? "brand" : "default"} disabled={!isAdmin || (current && usage?.status === "active")} loading={busy === p.id}
                onClick={() => go({ action: "checkout", plan_id: p.id }, p.id)}>
                {current ? (usage?.status === "active" ? "Nuvarande plan" : "Aktivera") : "Välj plan"}
              </Button>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Betalning hanteras säkert av Stripe. Planbyten och gränser kontrolleras på servern. Om Stripe inte är konfigurerat i miljön sker ingen debitering.</p>
    </div>
  );
}

export default function Settings() {
  const { tab = "foretag" } = useParams();
  const navigate = useNavigate();
  const content: Record<string, ReactNode> = {
    foretag: <CompanyTab />, team: <TeamTab />, ai: <AiTab />, offert: <QuoteTab />, uppfoljning: <FollowUpTab />,
    epost: <EmailTab />, aviseringar: <NotificationsTab />, sakerhet: <SecurityTab />, fakturering: <BillingTab />,
  };
  return (
    <div>
      <PageHeader title="Inställningar" />
      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Inställningar">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => navigate(`/app/installningar/${id}`)} aria-current={tab === id ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground", tab === id && "bg-accent text-foreground")}>
              {label}
            </button>
          ))}
        </nav>
        <div key={tab} className="min-w-0 animate-fade-up">{content[tab] ?? content.foretag}</div>
      </div>
    </div>
  );
}
