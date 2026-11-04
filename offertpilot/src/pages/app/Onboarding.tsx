import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { INDUSTRIES, UNITS } from "@/lib/labels";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

const STEPS = ["Företag", "Verksamhet", "Tjänster & priser"];
const STYLES = ["Professionell och vänlig", "Personlig och avslappnad", "Kortfattad och saklig", "Formell"];

interface ServiceDraft { name: string; unit: string; price: string; is_labor: boolean; lead_time: string }

export default function Onboarding() {
  const { org, settings, loading, refresh } = useOrg();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "", org_number: "", industry: INDUSTRIES[0], email: user?.email ?? "", phone: "", website: "", city: "", full_name: "",
    description: "", services_text: "", pricing_model: "", communication_style: STYLES[0],
  });
  const [services, setServices] = useState<ServiceDraft[]>([{ name: "", unit: "tim", price: "", is_labor: true, lead_time: "" }]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Om företaget redan skapats men onboarding inte är klar – fortsätt på steg 3
  useEffect(() => {
    if (org && settings && !settings.onboarding_completed) setStep(2);
  }, [org, settings]);

  if (!loading && org && settings?.onboarding_completed) return <Navigate to="/app" replace />;

  const validateStep = () => {
    if (step === 0) {
      if (f.name.trim().length < 2) return "Ange företagets namn.";
      if (f.org_number && !/^\d{6}-?\d{4}$/.test(f.org_number.trim())) return "Organisationsnumret ska ha formatet 556677-8899.";
      if (f.website && !/^https?:\/\/|^[a-z0-9.-]+\.[a-z]{2,}/i.test(f.website)) return "Ange en giltig webbadress.";
    }
    if (step === 1 && f.description.trim().length < 20) return "Beskriv verksamheten med några meningar – AI:n använder texten i sina svar.";
    return null;
  };

  const next = async () => {
    const err = validateStep();
    setError(err);
    if (err) return;
    if (step === 1 && !org) {
      setBusy(true);
      const description = [f.description.trim(), f.services_text.trim() && `Tjänster: ${f.services_text.trim()}`].filter(Boolean).join("\n\n");
      const { error } = await supabase.rpc("create_organization", {
        p: { ...f, description, website: f.website && !/^https?:\/\//.test(f.website) ? `https://${f.website}` : f.website },
      });
      setBusy(false);
      if (error) return setError(errorMessage(error));
      await refresh();
    }
    setStep((s) => s + 1);
  };

  const finish = async (skip = false) => {
    if (!org) return;
    setBusy(true);
    setError(null);
    try {
      const rows = services.filter((s) => s.name.trim());
      if (!skip && rows.length) {
        const bad = rows.find((s) => s.price && !(Number(s.price.replace(",", ".")) >= 0));
        if (bad) throw new Error(`Ogiltigt pris för "${bad.name}".`);
        const { error } = await supabase.from("services").insert(rows.map((s, i) => ({
          organization_id: org.id, name: s.name.trim(), unit: s.unit, is_labor: s.is_labor, sort: i,
          unit_price: s.price ? Number(s.price.replace(",", ".")) : null, default_lead_time: s.lead_time || null,
        })));
        if (error) throw error;
      }
      const { error } = await supabase.from("organization_settings").update({ onboarding_completed: true }).eq("organization_id", org.id);
      if (error) throw error;
      await refresh();
      toast.success("Klart! Ditt konto är redo.");
      navigate("/app");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Logo />
        <button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">Logga ut</button>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">
        <ol className="mb-10 flex items-center gap-3" aria-label="Steg">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-3">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs transition-colors duration-500", i < step ? "border-brand bg-brand text-white" : i === step ? "border-brand text-brand" : "text-muted-foreground")}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("hidden text-sm sm:block", i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1 transition-colors duration-500", i < step ? "bg-brand" : "bg-border")} />}
            </li>
          ))}
        </ol>

        <Card className="p-6 sm:p-10" key={step}>
          <div className="animate-fade-up">
            {step === 0 && (
              <>
                <p className="label-mono">Steg 1 av 3</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Berätta om ditt företag</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">Uppgifterna används i offerter och i AI:ns svar till kunder.</p>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <Field label="Företagsnamn *" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} placeholder="Svensson Bygg AB" autoFocus /></Field>
                  <Field label="Organisationsnummer"><Input value={f.org_number} onChange={set("org_number")} placeholder="556677-8899" inputMode="numeric" /></Field>
                  <Field label="Bransch"><Select value={f.industry} onChange={set("industry")}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select></Field>
                  <Field label="Ditt namn"><Input value={f.full_name} onChange={set("full_name")} placeholder="Erik Svensson" /></Field>
                  <Field label="Ort"><Input value={f.city} onChange={set("city")} placeholder="Uppsala" /></Field>
                  <Field label="E-post för kunder"><Input type="email" value={f.email} onChange={set("email")} /></Field>
                  <Field label="Telefon"><Input value={f.phone} onChange={set("phone")} placeholder="070-123 45 67" /></Field>
                  <Field label="Webbplats" className="sm:col-span-2"><Input value={f.website} onChange={set("website")} placeholder="https://svenssonbygg.se" /></Field>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <p className="label-mono">Steg 2 av 3</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Så arbetar ni</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">Ju tydligare beskrivning, desto bättre blir AI:ns analyser och utkast.</p>
                <div className="mt-8 grid gap-5">
                  <Field label="Beskrivning av verksamheten *"><Textarea value={f.description} onChange={set("description")} placeholder="Vi är ett familjeägt byggföretag i Uppsala med fokus på badrums- och köksrenoveringar för privatpersoner…" /></Field>
                  <Field label="Tjänster ni erbjuder" hint="Kort lista – detaljerade priser lägger du in i nästa steg."><Textarea value={f.services_text} onChange={set("services_text")} className="min-h-[72px]" placeholder="Badrumsrenovering, köksrenovering, plattsättning, mindre snickeriarbeten" /></Field>
                  <Field label="Prismodell" hint="T.ex. löpande timpris, fast pris per m² eller paketpris."><Input value={f.pricing_model} onChange={set("pricing_model")} placeholder="Fast pris per projekt, löpande timpris för tilläggsarbeten" /></Field>
                  <Field label="Kommunikationsstil"><Select value={f.communication_style} onChange={set("communication_style")}>{STYLES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <p className="label-mono">Steg 3 av 3</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tjänster och priser</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">AI:n använder <strong className="text-foreground">endast</strong> dessa priser. Lämnar du priset tomt måste det fyllas i manuellt i varje offert.</p>
                <div className="mt-8 space-y-3">
                  {services.map((s, i) => (
                    <div key={i} className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[1.6fr_.7fr_.8fr_.9fr_auto] sm:items-end">
                      <Field label="Tjänst"><Input value={s.name} onChange={(e) => setServices((x) => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} placeholder="Plattsättning" /></Field>
                      <Field label="Enhet"><Select value={s.unit} onChange={(e) => setServices((x) => x.map((y, j) => j === i ? { ...y, unit: e.target.value } : y))}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
                      <Field label="Pris exkl. moms"><Input inputMode="decimal" value={s.price} onChange={(e) => setServices((x) => x.map((y, j) => j === i ? { ...y, price: e.target.value } : y))} placeholder="650" /></Field>
                      <Field label="Leveranstid"><Input value={s.lead_time} onChange={(e) => setServices((x) => x.map((y, j) => j === i ? { ...y, lead_time: e.target.value } : y))} placeholder="2–3 veckor" /></Field>
                      <div className="flex items-center gap-2 pb-1">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Arbetskostnad som kan ge ROT-avdrag">
                          <input type="checkbox" checked={s.is_labor} onChange={(e) => setServices((x) => x.map((y, j) => j === i ? { ...y, is_labor: e.target.checked } : y))} className="accent-[hsl(var(--brand))]" />ROT
                        </label>
                        <Button variant="ghost" size="icon" aria-label="Ta bort" onClick={() => setServices((x) => x.filter((_, j) => j !== i))} disabled={services.length === 1}><Trash2 /></Button>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setServices((x) => [...x, { name: "", unit: "st", price: "", is_labor: false, lead_time: "" }])}><Plus />Lägg till tjänst</Button>
                </div>
              </>
            )}
          </div>

          {error && <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>}
          <div className="mt-10 flex items-center justify-between border-t pt-6">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || (step === 2 && !!org)}><ArrowLeft />Tillbaka</Button>
            {step < 2 ? (
              <Button variant="brand" onClick={next} loading={busy}>Fortsätt<ArrowRight /></Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => finish(true)} disabled={busy}>Hoppa över</Button>
                <Button variant="brand" onClick={() => finish(false)} loading={busy}>Slutför<Check /></Button>
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
