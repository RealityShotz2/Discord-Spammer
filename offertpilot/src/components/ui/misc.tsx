import type { HTMLAttributes, ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground border-border",
  brand: "bg-brand-soft text-brand border-brand/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", className, dot, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium", tones[tone], className)} {...p}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {p.children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-lg bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.05] before:to-transparent", className)} />;
}

export function Switch({ checked, onCheckedChange, disabled, id, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string; label?: string }) {
  return (
    <SwitchPrimitive.Root id={id} aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
      className="peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors duration-300 data-[state=checked]:bg-brand disabled:opacity-50">
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] rounded-full bg-white shadow transition-transform duration-300 ease-out data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand [&_svg]:size-5">{icon}</div>}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="label-mono mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AiBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const demo = source === "demo";
  return (
    <Badge tone={demo ? "warning" : "brand"} title={demo ? "Ingen AI-nyckel är konfigurerad. Resultatet kommer från en enkel regelmotor." : `Genererat av ${source}`}>
      <Sparkles className="size-3" />
      {demo ? "Demoläge" : "AI"}
    </Badge>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}
