import * as T from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <T.List className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1", className)}>{children}</T.List>;
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <T.Trigger value={value} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-all duration-300 hover:text-foreground data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5">
      {children}
    </T.Trigger>
  );
}
export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return <T.Content value={value} className={cn("mt-6 outline-none data-[state=active]:animate-[fade-up_.5s_cubic-bezier(0.16,1,0.3,1)]", className)}>{children}</T.Content>;
}
