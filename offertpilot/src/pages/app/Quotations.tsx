import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, Sparkles } from "lucide-react";
import { QUOTE_STATUS } from "@/lib/labels";
import type { QuoteStatus } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { cn, formatDate } from "@/lib/utils";
import { useQuotations } from "@/hooks/data";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

const FILTERS: { id: QuoteStatus | "all"; label: string }[] = [
  { id: "all", label: "Alla" }, { id: "draft", label: "Utkast" }, { id: "pending_approval", label: "Väntar" },
  { id: "approved", label: "Godkända" }, { id: "sent", label: "Skickade" }, { id: "accepted", label: "Accepterade" }, { id: "declined", label: "Avböjda" },
];

export default function Quotations() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "all") as QuoteStatus | "all";
  const quotes = useQuotations();
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: quotes.data?.length ?? 0 };
    for (const q of quotes.data ?? []) c[q.status] = (c[q.status] ?? 0) + 1;
    return c;
  }, [quotes.data]);
  const list = (quotes.data ?? []).filter((q) => status === "all" || q.status === status);

  return (
    <div>
      <PageHeader title="Offerter" description="Alla offerter kräver godkännande av en administratör innan de kan skickas." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={status === f.id} onClick={() => setParams(f.id === "all" ? {} : { status: f.id })}
            className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition", status === f.id && "bg-surface text-foreground shadow-sm")}>
            {f.label}<span className="font-mono text-[11px] opacity-60">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {quotes.isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        : !list.length ? (
          <EmptyState icon={<FileText />} title={status === "all" ? "Inga offerter ännu" : "Inga offerter i denna status"} description="Öppna en lead och klicka på “Skapa offert med AI” för att ta fram ett utkast med dina egna priser."
            action={<Button variant="brand" asChild><Link to="/app/leads">Gå till leads</Link></Button>} />
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b bg-muted/40 text-left"><tr>{["Nummer", "Titel", "Kund", "Status", "Giltig till", "Totalt"].map((h, i) => <th key={h} className={cn("label-mono px-4 py-3 font-normal", i === 5 && "text-right")}>{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((q) => (
                    <tr key={q.id} className="group border-b transition-colors last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3.5 font-mono text-xs"><Link to={`/app/offerter/${q.id}`} className="hover:text-brand">{q.number}</Link></td>
                      <td className="max-w-[280px] px-4 py-3.5"><Link to={`/app/offerter/${q.id}`} className="flex items-center gap-2 font-medium group-hover:text-brand"><span className="truncate">{q.title}</span>{q.ai_generated && <Sparkles className="size-3.5 shrink-0 text-brand" />}</Link></td>
                      <td className="px-4 py-3.5 text-muted-foreground">{q.customers?.name}</td>
                      <td className="px-4 py-3.5"><Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>{q.requires_manual_input && q.status === "draft" && <Badge tone="warning" className="ml-1.5">Pris saknas</Badge>}</td>
                      <td className="px-4 py-3.5 text-muted-foreground">{formatDate(q.valid_until)}</td>
                      <td className="px-4 py-3.5 text-right font-mono tabular">{formatSEK(q.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}
