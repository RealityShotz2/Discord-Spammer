import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BellRing, Building2, Check, ChevronDown, Clock, FileCheck2, Hammer, Inbox, Lock, Mail, Paintbrush, PlugZap,
  ShieldCheck, Sparkles, Sprout, Truck, Wrench, Zap,
} from "lucide-react";
import { useReveal } from "@/hooks/useReveal";
import { formatPlanPrice, PLANS } from "@shared/plans.ts";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/Logo";
import { HeroCanvas } from "@/components/marketing/HeroCanvas";
import { ProductPreview } from "@/components/marketing/ProductPreview";

const cta = "group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-xl px-6 text-[15px] font-medium will-change-transform transition-[transform,box-shadow,background-color] duration-500 ease-out hover:-translate-y-0.5 active:scale-[0.98]";

const STEPS = [
  { n: "01", icon: Inbox, title: "Förfrågan kommer in", text: "Via formuläret på din webbplats eller registrerad manuellt efter ett samtal. Allt samlas på ett ställe." },
  { n: "02", icon: Sparkles, title: "AI analyserar", text: "Sammanfattar behovet, matchar mot dina tjänster och listar vad som saknas – med färdiga följdfrågor." },
  { n: "03", icon: FileCheck2, title: "Offert med dina priser", text: "Ett strukturerat utkast med rader, moms och ROT. Priserna hämtas alltid från din egen prislista." },
  { n: "04", icon: BellRing, title: "Godkänn och följ upp", text: "Du granskar och godkänner. Kunden svarar via länk och påminnelser schemaläggs automatiskt." },
];

const BENEFITS = [
  { icon: Clock, title: "Svara samma dag", text: "Påminnelser när en förfrågan blir liggande, och svarsutkast som redan ställer rätt frågor.", span: "md:col-span-2" },
  { icon: Lock, title: "Inga påhittade priser", text: "AI:n får aldrig sätta egna priser, rabatter eller leveranstider. Saknas något flaggas det för dig." },
  { icon: ShieldCheck, title: "Du godkänner alltid", text: "Ingen offert och inget meddelande lämnar systemet utan ett aktivt godkännande." },
  { icon: Zap, title: "Pipeline i realtid", text: "Dra leads mellan stegen och se pipelinevärde, konvertering och uppföljningar på en blick.", span: "md:col-span-2" },
  { icon: Building2, title: "Byggt för Sverige", text: "Svenska som standard, moms 25/12/6 %, ROT-avdrag, organisationsnummer och kronor." },
  { icon: PlugZap, title: "GDPR från början", text: "Data isoleras per företag, export och radering med ett klick och full aktivitetslogg.", span: "md:col-span-2" },
];

const INDUSTRIES = [
  { icon: Hammer, label: "Bygg & renovering" }, { icon: Zap, label: "El & installation" }, { icon: Wrench, label: "VVS" },
  { icon: Paintbrush, label: "Måleri" }, { icon: Sprout, label: "Trädgård & mark" }, { icon: Truck, label: "Flytt & transport" },
  { icon: Building2, label: "Fastighetsservice" }, { icon: Sparkles, label: "Städ" },
];

// Planer, priser och funktioner kommer från den centrala konfigurationen
const PLAN_CARDS = PLANS.map((p) => ({ ...p, price: formatPlanPrice(p.priceSek), desc: p.description }));

const FAQ = [
  ["Hittar AI:n på priser?", "Nej. AI:n väljer bara tjänster ur din egen katalog och servern hämtar priset därifrån. Saknas ett pris markeras raden och offerten kan inte godkännas förrän du fyllt i det."],
  ["Skickas något automatiskt till mina kunder?", "Nej. Varje offert och varje uppföljning kräver att du eller en administratör godkänner den. Automatiska utskick kan bli ett val i framtiden, men är alltid avstängt som standard."],
  ["Hur fungerar webbformuläret?", "Du kopierar en kodrad till din webbplats. Förfrågningar skapar en lead direkt i Offertfabriken, skyddat mot spam med validering, honeypot och begränsning av antal förfrågningar."],
  ["Var lagras min data?", "I en PostgreSQL-databas där varje företags data är isolerad med Row Level Security. Du kan exportera eller radera kunddata när som helst för att uppfylla GDPR."],
  ["Kan jag använda det med ROT-avdrag?", "Ja. Markera arbetskostnader i din prislista så räknar offerten fram ett preliminärt ROT-avdrag med den procentsats du anger."],
  ["Vad räknas som en AI-assisterad lead?", "En lead där AI har använts minst en gång under månaden – oavsett hur många analyser, utkast eller svar du skapar för just den förfrågan."],
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-6 py-6 text-left">
        <span className="text-[17px] font-medium tracking-tight text-white">{q}</span>
        <ChevronDown className={cn("size-5 shrink-0 text-white/40 transition-transform duration-500 ease-out", open && "rotate-180 text-indigo-300")} />
      </button>
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-500 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <p className="overflow-hidden pb-0 text-[15px] leading-relaxed text-white/60 [&:not(:empty)]:pb-6">{a}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const ref = useReveal<HTMLDivElement>();
  const { user } = useAuth();

  return (
    <div ref={ref} className="dark min-h-screen bg-[#05070f] text-white antialiased [color-scheme:dark]">
      {/* Navigering */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#05070f]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Offertfabriken – startsida"><Logo /></Link>
          <nav className="hidden items-center gap-8 text-[13.5px] text-white/60 md:flex" aria-label="Huvudmeny">
            <a href="#sa-fungerar-det" className="transition hover:text-white">Så fungerar det</a>
            <a href="#fordelar" className="transition hover:text-white">Fördelar</a>
            <a href="#priser" className="transition hover:text-white">Priser</a>
            <a href="#fragor" className="transition hover:text-white">Frågor</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? <Link to="/app" className="rounded-lg bg-white px-4 py-2 text-[13.5px] font-medium text-[#05070f] transition hover:-translate-y-px">Till appen</Link> : <>
              <Link to="/logga-in" className="hidden rounded-lg px-3 py-2 text-[13.5px] text-white/70 transition hover:text-white sm:block">Logga in</Link>
              <Link to="/registrera" className="rounded-lg bg-white px-4 py-2 text-[13.5px] font-medium text-[#05070f] transition duration-300 ease-out hover:-translate-y-px hover:shadow-[0_8px_24px_-6px_rgba(255,255,255,0.4)]">Kom igång</Link>
            </>}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pb-24 pt-36 sm:pb-32 sm:pt-44">
        <div className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <HeroCanvas className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#05070f]" />
        <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="max-w-3xl">
            <p className="reveal inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-200">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-indigo-400" />AI-säljassistent för svenska företag
            </p>
            <h1 className="reveal mt-7 text-[44px] font-semibold leading-[1.02] tracking-tight sm:text-[72px] lg:text-[84px]" style={{ "--d": "80ms" } as React.CSSProperties}>
              Fler affärer.<br /><span className="bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-400 bg-clip-text text-transparent">Mindre administration.</span>
            </h1>
            <p className="reveal mt-7 max-w-xl text-[17px] leading-relaxed text-white/60 sm:text-lg" style={{ "--d": "160ms" } as React.CSSProperties}>
              Din AI-drivna säljassistent som hanterar kundförfrågningar, förbereder offerter och hjälper dig följa upp varje affärsmöjlighet.
            </p>
            <div className="reveal mt-10 flex flex-col gap-3 sm:flex-row" style={{ "--d": "240ms" } as React.CSSProperties}>
              <Link to="/registrera" className={cn(cta, "bg-indigo-500 text-white shadow-[0_12px_40px_-12px_rgba(99,102,241,0.9)] hover:bg-indigo-400 hover:shadow-[0_18px_48px_-12px_rgba(99,102,241,1)]")}>
                Kom igång med Offertfabriken<ArrowRight className="size-4 transition-transform duration-500 ease-out group-hover:translate-x-1" />
              </Link>
              <a href="#sa-fungerar-det" className={cn(cta, "border border-white/15 bg-white/[0.03] text-white/90 hover:bg-white/[0.07]")}>Se hur det fungerar</a>
            </div>
            <p className="reveal mt-6 font-mono text-[11.5px] text-white/35" style={{ "--d": "320ms" } as React.CSSProperties}>14 dagars provperiod · Inget kort krävs · Avsluta när du vill</p>
          </div>
        </div>
      </section>

      {/* Produktförhandsvisning */}
      <section className="relative px-4 pb-24 sm:px-6 sm:pb-32">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <div>
            <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Från förfrågan till offert</p>
            <h2 className="reveal mt-4 text-3xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.08]" style={{ "--d": "80ms" } as React.CSSProperties}>Det som tog en kväll tar nu några minuter.</h2>
            <p className="reveal mt-5 max-w-md text-[16px] leading-relaxed text-white/55" style={{ "--d": "160ms" } as React.CSSProperties}>Offertfabriken läser förfrågan, förstår vad kunden vill och sätter ihop ett utkast med dina tjänster och priser. Du granskar, justerar och godkänner.</p>
            <ul className="mt-8 space-y-3">
              {["Analys och följdfrågor direkt när förfrågan kommer in", "Offertrader med mängder hämtade ur kundens text", "Tydliga varningar när något saknas"].map((x, i) => (
                <li key={x} className="reveal flex gap-3 text-[15px] text-white/75" style={{ "--d": `${200 + i * 80}ms` } as React.CSSProperties}><Check className="mt-0.5 size-4 shrink-0 text-indigo-300" />{x}</li>
              ))}
            </ul>
          </div>
          <div className="reveal" style={{ "--d": "120ms" } as React.CSSProperties}><ProductPreview /></div>
        </div>
      </section>

      {/* Så fungerar det */}
      <section id="sa-fungerar-det" className="scroll-mt-20 border-t border-white/[0.06] px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-[1240px]">
          <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Så fungerar det</p>
          <h2 className="reveal mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.08]" style={{ "--d": "80ms" } as React.CSSProperties}>Fyra steg. Du har kontrollen i varje.</h2>
          <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.06] md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.n} className="reveal group bg-[#070a16] p-8 transition-colors duration-500 hover:bg-[#0a0e1e]" style={{ "--d": `${i * 90}ms` } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <s.icon className="size-5 text-indigo-300 transition-transform duration-500 ease-out group-hover:-translate-y-0.5 group-hover:scale-110" />
                  <span className="font-mono text-xs text-white/30">{s.n}</span>
                </div>
                <h3 className="mt-10 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-white/50">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fördelar */}
      <section id="fordelar" className="scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-[1240px]">
          <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Fördelar</p>
          <h2 className="reveal mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.08]" style={{ "--d": "80ms" } as React.CSSProperties}>Byggt för att du ska vinna fler affärer – säkert.</h2>
          <div className="mt-16 grid gap-4 md:grid-cols-3">
            {BENEFITS.map((b, i) => (
              <div key={b.title} className={cn("reveal group relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-8 will-change-transform transition-[transform,border-color] duration-500 ease-out hover:-translate-y-1 hover:border-indigo-400/30", b.span)} style={{ "--d": `${i * 70}ms` } as React.CSSProperties}>
                <div className="pointer-events-none absolute -right-20 -top-20 size-48 rounded-full bg-indigo-500/0 blur-3xl transition-colors duration-700 group-hover:bg-indigo-500/20" />
                <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04]"><b.icon className="size-[18px] text-indigo-200" /></div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight">{b.title}</h3>
                <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-white/50">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Branscher */}
      <section className="border-y border-white/[0.06] px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-[1240px] text-center">
          <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Branscher</p>
          <h2 className="reveal mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl" style={{ "--d": "80ms" } as React.CSSProperties}>För företag som lever på offerter</h2>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            {INDUSTRIES.map((x, i) => (
              <span key={x.label} className="reveal inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-white/75 transition-[transform,border-color] duration-500 ease-out hover:-translate-y-0.5 hover:border-indigo-400/40" style={{ "--d": `${i * 50}ms` } as React.CSSProperties}>
                <x.icon className="size-4 text-indigo-300" />{x.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Priser */}
      <section id="priser" className="scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-[1240px]">
          <div className="text-center">
            <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Priser</p>
            <h2 className="reveal mt-4 text-3xl font-semibold tracking-tight sm:text-[44px]" style={{ "--d": "80ms" } as React.CSSProperties}>Enkla priser. Ingen bindningstid.</h2>
            <p className="reveal mt-4 text-white/50" style={{ "--d": "160ms" } as React.CSSProperties}>Alla priser per månad, exklusive moms.</p>
          </div>
          <div className="mt-16 grid gap-4 lg:grid-cols-3">
            {PLAN_CARDS.map((p, i) => (
              <div key={p.id} className={cn("reveal relative flex flex-col rounded-3xl border p-8 will-change-transform transition-[transform,border-color] duration-500 ease-out hover:-translate-y-1",
                p.featured ? "border-indigo-400/40 bg-gradient-to-b from-indigo-500/[0.12] to-white/[0.02] shadow-[0_30px_80px_-40px_rgba(99,102,241,0.8)]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/20")} style={{ "--d": `${i * 90}ms` } as React.CSSProperties}>
                {p.featured && <span className="absolute -top-3 left-8 rounded-full bg-indigo-500 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em]">Populärast</span>}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-white/50">{p.desc}</p>
                <p className="mt-8 flex items-baseline gap-1.5"><span className="text-5xl font-semibold tracking-tight">{p.price}</span><span className="font-mono text-sm text-white/40">kr/mån</span></p>
                <ul className="mt-8 flex-1 space-y-3">{p.features.map((f) => <li key={f} className="flex gap-3 text-[14.5px] text-white/75"><Check className="mt-0.5 size-4 shrink-0 text-indigo-300" />{f}</li>)}</ul>
                <Link to="/registrera" className={cn(cta, "mt-10 w-full", p.featured ? "bg-indigo-500 hover:bg-indigo-400" : "border border-white/15 hover:bg-white/[0.06]")}>Starta provperiod</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="fragor" className="scroll-mt-20 border-t border-white/[0.06] px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto grid max-w-[1240px] gap-12 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <p className="reveal font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Vanliga frågor</p>
            <h2 className="reveal mt-4 text-3xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.08]" style={{ "--d": "80ms" } as React.CSSProperties}>Bra att veta</h2>
            <p className="reveal mt-4 max-w-sm text-white/50" style={{ "--d": "160ms" } as React.CSSProperties}>Hittar du inte svaret? Mejla oss på <a href="mailto:hej@offertfabriken.se" className="text-white underline-offset-4 hover:underline">hej@offertfabriken.se</a>.</p>
          </div>
          <div className="reveal border-t border-white/10" style={{ "--d": "120ms" } as React.CSSProperties}>{FAQ.map(([q, a]) => <FaqItem key={q} q={q} a={a} />)}</div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 sm:px-6 sm:pb-32">
        <div className="reveal relative mx-auto max-w-[1240px] overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-indigo-600/30 via-[#0b0f22] to-violet-700/20 px-6 py-20 text-center sm:px-16">
          <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-indigo-500/30 blur-[100px]" />
          <h2 className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">Svara på nästa förfrågan med en färdig offert.</h2>
          <p className="relative mx-auto mt-5 max-w-lg text-white/60">Kom igång på några minuter. Lägg in dina tjänster och priser – resten sköter Offertfabriken.</p>
          <Link to="/registrera" className={cn(cta, "relative mt-10 bg-white text-[#05070f] hover:shadow-[0_18px_48px_-12px_rgba(255,255,255,0.5)]")}>Kom igång med Offertfabriken<ArrowRight className="size-4 transition-transform duration-500 ease-out group-hover:translate-x-1" /></Link>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-4 py-14 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 sm:flex-row sm:justify-between">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-white/40">AI-driven säljassistent för svenska små och medelstora företag.</p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div className="space-y-3"><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/30">Produkt</p><a href="#sa-fungerar-det" className="block text-white/60 hover:text-white">Så fungerar det</a><a href="#priser" className="block text-white/60 hover:text-white">Priser</a><Link to="/logga-in" className="block text-white/60 hover:text-white">Logga in</Link></div>
            <div className="space-y-3"><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/30">Juridik</p><Link to="/integritet" className="block text-white/60 hover:text-white">Integritetspolicy</Link><Link to="/villkor" className="block text-white/60 hover:text-white">Användarvillkor</Link></div>
            <div className="space-y-3"><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/30">Kontakt</p><a href="mailto:hej@offertfabriken.se" className="flex items-center gap-2 text-white/60 hover:text-white"><Mail className="size-3.5" />hej@offertfabriken.se</a><p className="text-white/40">Sverige</p></div>
          </div>
        </div>
        <p className="mx-auto mt-12 max-w-[1240px] font-mono text-[11px] text-white/25">© {new Date().getFullYear()} Offertfabriken</p>
      </footer>
    </div>
  );
}
