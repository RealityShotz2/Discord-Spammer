import { useId } from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  // Unikt gradient-id per instans: flera logotyper i DOM (t.ex. dold sidomeny) får inte dela id
  const gid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0b1020" />
      <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(255,255,255,.12)" />
      <path d="M9 22.5 16 8l7 14.5-7-4.2z" fill={`url(#${gid})`} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">Offertfabriken<span className="ml-1 font-mono text-[11px] font-medium text-brand">AI</span></span>
    </span>
  );
}
