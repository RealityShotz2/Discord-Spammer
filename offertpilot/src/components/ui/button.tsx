import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium will-change-transform transition-[transform,background-color,box-shadow,opacity,color] duration-300 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:-translate-y-px hover:shadow-md hover:shadow-primary/10",
        brand: "bg-brand text-white shadow-[0_8px_24px_-8px_hsl(var(--brand)/0.6)] hover:-translate-y-px hover:shadow-[0_12px_32px_-8px_hsl(var(--brand)/0.7)]",
        outline: "border border-border bg-surface hover:-translate-y-px hover:bg-accent",
        ghost: "hover:bg-accent",
        subtle: "bg-accent text-accent-foreground hover:bg-accent/70",
        destructive: "bg-destructive text-destructive-foreground hover:-translate-y-px hover:bg-destructive/90",
        link: "text-brand underline-offset-4 hover:underline active:scale-100",
      },
      size: { sm: "h-8 px-3 text-[13px]", default: "h-10 px-4", lg: "h-12 px-6 text-[15px]", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {asChild ? children : <>{loading && <Loader2 className="animate-spin" />}{children}</>}
    </Comp>
  );
});
Button.displayName = "Button";
