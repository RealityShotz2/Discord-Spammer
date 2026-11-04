import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-xl border border-input bg-surface px-3 text-sm shadow-sm shadow-black/[0.02] transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-10", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-[96px] py-2.5 leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";

const CHEVRON = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>")`;

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, "h-10 appearance-none bg-no-repeat pr-9", className)} {...p} style={{ backgroundImage: CHEVRON, backgroundSize: "14px", backgroundPosition: "right 0.75rem center", ...p.style }}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-foreground/90", className)} {...p} />;
}

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  // Kopplar etiketten till fältet automatiskt (tillgänglighet) om inget id angetts
  const auto = useId();
  const hintId = `${auto}-hint`;
  let id = htmlFor;
  let child = children;
  if (isValidElement<{ id?: string; "aria-describedby"?: string }>(children)) {
    id = children.props.id ?? htmlFor ?? auto;
    child = cloneElement(children, { id, "aria-describedby": hint || error ? hintId : undefined });
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {child}
      {error ? <p id={hintId} className="text-xs text-destructive">{error}</p> : hint ? <p id={hintId} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
