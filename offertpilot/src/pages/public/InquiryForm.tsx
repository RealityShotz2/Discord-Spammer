import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { LogoMark } from "@/components/layout/Logo";

export default function InquiryForm() {
  const { key = "" } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const started = useRef(Date.now());
  const root = useRef<HTMLDivElement>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", city: "", service: "", message: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const info = useQuery({
    queryKey: ["form", key],
    retry: false,
    queryFn: () => callFunction<{ name: string; services: string[]; brand_color: string | null }>(`public-inquiry?key=${encodeURIComponent(key)}`, undefined, { method: "GET", auth: false }),
  });

  // Rapportera höjd till inbäddande sida (embed.js)
  useEffect(() => {
    if (!embed || !root.current) return;
    const ro = new ResizeObserver(() => window.parent.postMessage({ type: "offertpilot:height", height: root.current!.scrollHeight + 8 }, "*"));
    ro.observe(root.current);
    return () => ro.disconnect();
  }, [embed, done, info.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consent) return setError("Du behöver godkänna att vi behandlar dina uppgifter.");
    setBusy(true);
    try {
      await callFunction("public-inquiry", { key, ...f, consent, started_at: started.current }, { auth: false });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const brand = info.data?.brand_color ?? undefined;
  return (
    <div ref={root} className={cn("bg-background", !embed && "min-h-screen px-4 py-12 sm:py-20")} style={brand ? ({ "--brand-hex": brand } as React.CSSProperties) : undefined}>
      <div className={cn("mx-auto w-full max-w-xl", !embed && "rounded-3xl border bg-card p-6 shadow-sm sm:p-10")}>
        {info.isLoading ? <div className="space-y-4"><Skeleton className="h-8 w-60" /><Skeleton className="h-64" /></div>
          : info.error ? <p className="py-10 text-center text-sm text-muted-foreground">Formuläret kunde inte hittas.</p>
          : done ? (
            <div className="py-10 text-center animate-fade-up">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/10 text-success"><CheckCircle2 className="size-7" /></div>
              <h1 className="mt-5 text-xl font-semibold tracking-tight">Tack för din förfrågan!</h1>
              <p className="mt-2 text-sm text-muted-foreground">{info.data!.name} har tagit emot den och återkommer så snart som möjligt.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="animate-fade-up">
              <p className="label-mono">Offertförfrågan</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Berätta vad du behöver hjälp med</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{info.data!.name} svarar vanligtvis inom en arbetsdag.</p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <Field label="Namn *"><Input value={f.name} onChange={set("name")} autoComplete="name" required /></Field>
                <Field label="E-post *"><Input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></Field>
                <Field label="Telefon"><Input type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></Field>
                <Field label="Ort"><Input value={f.city} onChange={set("city")} autoComplete="address-level2" /></Field>
                {!!info.data!.services.length && (
                  <Field label="Tjänst" className="sm:col-span-2">
                    <Select value={f.service} onChange={set("service")}><option value="">Välj tjänst (valfritt)</option>{info.data!.services.map((s) => <option key={s}>{s}</option>)}<option>Annat</option></Select>
                  </Field>
                )}
                <Field label="Beskriv ditt ärende *" className="sm:col-span-2" hint="T.ex. storlek, önskad tidpunkt och eventuella önskemål.">
                  <Textarea value={f.message} onChange={set("message")} className="min-h-[140px]" required />
                </Field>
                {/* Honeypot – dolt för människor */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label>Webbplats<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
                </div>
              </div>
              <label className="mt-5 flex items-start gap-2.5 text-[13px] text-muted-foreground">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[hsl(var(--brand))]" />
                <span>Jag godkänner att {info.data!.name} behandlar mina uppgifter för att besvara förfrågan. Uppgifterna delas inte med andra.</span>
              </label>
              {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
              <Button type="submit" variant="brand" size="lg" className="mt-6 w-full" loading={busy} style={brand ? { background: brand } : undefined}>Skicka förfrågan</Button>
              <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5" />Skyddat formulär · <LogoMark className="size-3.5" />Offertfabriken</p>
            </form>
          )}
      </div>
    </div>
  );
}
