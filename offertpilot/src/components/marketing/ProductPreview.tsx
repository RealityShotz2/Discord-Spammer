import { useEffect, useState } from "react";
import { Check, FileText, Inbox, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "inquiry", label: "Förfrågan", icon: Inbox },
  { id: "analysis", label: "AI-analys", icon: Sparkles },
  { id: "quote", label: "Offert", icon: FileText },
] as const;

const ROWS = [
  ["Rivning befintligt badrum", "6 m²", "7 200 kr"],
  ["Tätskikt våtrum", "6 m²", "5 100 kr"],
  ["Plattsättning golv och vägg", "18,5 m²", "17 575 kr"],
  ["Etableringsavgift", "1 st", "1 500 kr"],
];

/** Interaktiv förhandsvisning av flödet. Exempeldata – inga riktiga kunder. */
export function ProductPreview() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4200);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div className="relative rounded-[28px] border border-white/10 bg-white/[0.03] p-2 shadow-[0_40px_120px_-40px_rgba(79,70,229,0.55)] backdrop-blur-xl"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#0b0f1f]">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-3 font-mono text-[10.5px] text-white/40">app.offertfabriken.se/leads/maria-lind</span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">Exempel</span>
        </div>
        <div role="tablist" aria-label="Flöde" className="flex gap-1 border-b border-white/10 p-2">
          {STEPS.map((s, i) => (
            <button key={s.id} role="tab" aria-selected={step === i} onClick={() => { setStep(i); setPaused(true); }}
              className={cn("relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-[12.5px] font-medium text-white/50 transition-colors duration-300 hover:text-white/80", step === i && "bg-white/[0.06] text-white")}>
              <s.icon className="size-3.5" />{s.label}
              {step === i && !paused && <span className="absolute inset-x-0 bottom-0 h-px origin-left animate-[grow_4.2s_linear] bg-indigo-400" />}
            </button>
          ))}
        </div>

        <div className="relative h-[340px] p-5 sm:p-6">
          {/* Förfrågan */}
          <Panel active={step === 0}>
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-indigo-500/20 font-mono text-xs text-indigo-200">ML</span>
              <div><p className="text-sm font-medium text-white">Maria Lind</p><p className="font-mono text-[11px] text-white/40">via webbformulär · Uppsala</p></div>
              <span className="ml-auto rounded-full border border-indigo-400/30 bg-indigo-400/10 px-2 py-0.5 text-[11px] text-indigo-200">Ny</span>
            </div>
            <p className="mt-5 rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.04] p-4 text-[13.5px] leading-relaxed text-white/80">
              Hej! Vi vill renovera vårt badrum på 6 kvm i höst. Allt ska rivas och nytt kakel sättas på golv och väggar. Kan ni lämna en offert?
            </p>
          </Panel>

          {/* Analys */}
          <Panel active={step === 1}>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-indigo-300">Sammanfattning</p>
            <p className="mt-1.5 text-[13.5px] text-white/85">Totalrenovering av badrum, 6 m², start under hösten.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40">Saknas</p>
                <ul className="mt-2 space-y-1.5 text-[13px] text-white/70">{["Adress för uppdraget", "Budget eller prisram"].map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1 rounded-full bg-amber-400" />{x}</li>)}</ul>
              </div>
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40">Matchade tjänster</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{["Rivning", "Tätskikt", "Plattsättning"].map((x) => <span key={x} className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11.5px] text-white/75">{x}</span>)}</div>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-indigo-400/20 bg-indigo-400/[0.07] p-3 text-[13px] text-indigo-100">
              <Sparkles className="mt-0.5 size-4 shrink-0" />Nästa steg: skapa offertutkast och fråga efter adress.
            </div>
          </Panel>

          {/* Offert */}
          <Panel active={step === 2}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">Offert OFF-1042 · Badrumsrenovering</p>
              <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300"><ShieldCheck className="size-3" />Väntar på ditt godkännande</span>
            </div>
            <div className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/10">
              {ROWS.map(([d, q, s], i) => (
                <div key={d} className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px] opacity-0 animate-fade-up" style={{ animationDelay: `${120 + i * 90}ms` }}>
                  <Check className="size-3.5 text-indigo-300" /><span className="flex-1 text-white/80">{d}</span><span className="font-mono text-white/40">{q}</span><span className="w-20 text-right font-mono text-white">{s}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-[11.5px] text-white/40">Priser från din egen prislista</p>
              <div className="text-right"><p className="font-mono text-[11px] text-white/40">Totalt inkl. moms</p><p className="font-mono text-lg text-white">39 218,75 kr</p></div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div aria-hidden={!active}
      className={cn("absolute inset-0 p-5 transition-[opacity,transform] duration-700 ease-out sm:p-6", active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0")}>
      {children}
    </div>
  );
}
