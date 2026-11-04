import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" className="w-fit"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12 animate-fade-up">
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">© {new Date().getFullYear()} OffertPilot AI · <Link to="/integritet" className="hover:text-foreground">Integritet</Link></p>
      </div>
      <div className="relative hidden overflow-hidden bg-[#070a16] lg:block">
        <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:56px_56px]" />
        <div className="absolute -right-32 -top-32 size-[520px] rounded-full bg-indigo-600/30 blur-[120px]" />
        <div className="absolute -bottom-40 left-10 size-[460px] rounded-full bg-violet-700/25 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-300">Säljassistent för svenska företag</p>
          <p className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight">Svara snabbare. Offerera med dina egna priser. Följ upp varje affär.</p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[["100 %", "dina egna priser"], ["0", "utskick utan godkännande"], ["SV", "svenska som standard"]].map(([v, l]) => (
              <div key={l}><p className="font-mono text-lg text-white">{v}</p><p className="mt-1 text-xs text-white/50">{l}</p></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PasswordHint() {
  return <span>Minst 10 tecken med stora och små bokstäver samt siffror.</span>;
}

export const passwordValid = (p: string) => p.length >= 10 && /[a-zåäö]/.test(p) && /[A-ZÅÄÖ]/.test(p) && /\d/.test(p);
