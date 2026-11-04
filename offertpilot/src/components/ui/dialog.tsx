import type { ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, title, description, children, footer, className, trigger }: {
  open?: boolean; onOpenChange?: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string; trigger?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-up_.2s_ease-out]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-popover shadow-2xl outline-none data-[state=open]:animate-[dialog-in_.35s_cubic-bezier(0.16,1,0.3,1)]",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close className="rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Stäng"><X className="size-4" /></D.Close>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t p-4">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
