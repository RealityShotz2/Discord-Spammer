import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowRightLeft, Columns3, Globe, List, Mail, MoreHorizontal, Phone, Plus, Search, Sparkles, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { PRIORITY, SOURCES, STAGES, stageLabel } from "@/lib/labels";
import type { Lead, LeadStage } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { cn, relativeTime } from "@/lib/utils";
import { useLeads } from "@/hooks/data";
import { useOrgId } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { NewLeadDialog } from "@/components/app/NewLeadDialog";

const sourceIcon = { website: Globe, email: Mail, phone: Phone, manual: Users, other: Users };

function LeadCard({ lead, onMove, overlay }: { lead: Lead; onMove: (id: string, stage: LeadStage) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, data: { stage: lead.stage } });
  const navigate = useNavigate();
  const Icon = sourceIcon[lead.source];
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onClick={() => !isDragging && navigate(`/app/leads/${lead.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/app/leads/${lead.id}`)}
      aria-label={`${lead.title}, ${stageLabel(lead.stage)}`}
      className={cn(
        "group cursor-grab touch-none rounded-xl border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] will-change-transform transition-[transform,box-shadow,border-color,opacity] duration-300 ease-out hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md active:cursor-grabbing",
        isDragging && !overlay && "opacity-30",
        overlay && "rotate-[1.5deg] scale-[1.03] shadow-2xl",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[13.5px] font-medium leading-snug">{lead.customers?.name ?? "Okänd kund"}</p>
        <Menu trigger={
          <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-accent" aria-label="Flytta lead">
            <MoreHorizontal className="size-4" />
          </button>
        }>
          <MenuLabel>Flytta till</MenuLabel>
          {STAGES.filter((s) => s.id !== lead.stage).map((s) => <MenuItem key={s.id} onSelect={() => onMove(lead.id, s.id)}><ArrowRightLeft />{s.label}</MenuItem>)}
        </Menu>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{lead.ai_summary ?? lead.requested_service ?? lead.message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {lead.ai_priority && <Badge tone={PRIORITY[lead.ai_priority].tone}>{PRIORITY[lead.ai_priority].label}</Badge>}
        {lead.ai_analyzed_at && <Badge tone="brand"><Sparkles className="size-3" />Analyserad</Badge>}
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{relativeTime(lead.created_at)}</span>
        {lead.estimated_value ? <span className="font-mono tabular text-foreground">{formatSEK(lead.estimated_value)}</span> : null}
      </div>
    </div>
  );
}

function Column({ stage, leads, onMove }: { stage: (typeof STAGES)[number]; leads: Lead[]; onMove: (id: string, s: LeadStage) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const value = leads.reduce((s, l) => s + (l.estimated_value ?? 0), 0);
  return (
    <section ref={setNodeRef} aria-label={stage.label}
      className={cn("flex w-[280px] shrink-0 flex-col rounded-2xl border bg-muted/40 transition-[background-color,border-color] duration-300", isOver && "border-brand/40 bg-brand-soft/60")}>
      <header className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", stage.id === "won" ? "bg-success" : stage.id === "lost" ? "bg-muted-foreground/50" : "bg-brand")} />
          <h2 className="text-[13px] font-semibold">{stage.label}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">{leads.length}</span>
        </div>
        {value > 0 && <span className="font-mono text-[11px] text-muted-foreground">{formatSEK(value)}</span>}
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2 pt-1">
        {leads.map((l) => <LeadCard key={l.id} lead={l} onMove={onMove} />)}
        {!leads.length && <p className="px-2 py-6 text-center text-xs text-muted-foreground/70">{stage.hint}</p>}
      </div>
    </section>
  );
}

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const org = useOrgId();
  const qc = useQueryClient();
  const leads = useLeads();
  const [view, setView] = useState<"board" | "list">(() => {
    try { return (localStorage.getItem("op-leads-view") as "board" | "list") ?? "board"; } catch { return "board"; }
  });
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const newOpen = params.get("ny") === "1";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return leads.data ?? [];
    return (leads.data ?? []).filter((l) => [l.title, l.customers?.name, l.customers?.email, l.requested_service, l.message].some((v) => v?.toLowerCase().includes(s)));
  }, [leads.data, q]);

  const move = async (id: string, stage: LeadStage) => {
    const key = ["leads", org];
    const prev = qc.getQueryData<Lead[]>(key);
    const position = Date.now() / 1000;
    qc.setQueryData<Lead[]>(key, (old) => old?.map((l) => (l.id === id ? { ...l, stage, position } : l)));
    const { error } = await supabase.from("leads").update({ stage, position }).eq("id", id);
    if (error) {
      qc.setQueryData(key, prev);
      toast.error(errorMessage(error));
    } else {
      toast.success(`Flyttad till ${stageLabel(stage)}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const to = e.over?.id as LeadStage | undefined;
    if (to && e.active.data.current?.stage !== to) move(String(e.active.id), to);
  };

  const setViewPersist = (v: "board" | "list") => {
    setView(v);
    try { localStorage.setItem("op-leads-view", v); } catch { /* ignoreras */ }
  };
  const active = leads.data?.find((l) => l.id === activeId);

  return (
    <div>
      <PageHeader title="Leads" description="Dra korten mellan stegen för att uppdatera pipelinen. Klicka för att se AI-analys och historik."
        actions={<Button variant="brand" onClick={() => setParams({ ny: "1" })}><Plus />Ny lead</Button>} />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök kund, tjänst eller text…" className="pl-9" aria-label="Sök leads" />
        </div>
        <div className="inline-flex rounded-xl border bg-muted/60 p-1" role="group" aria-label="Vy">
          {([["board", Columns3, "Tavla"], ["list", List, "Lista"]] as const).map(([v, Icon, label]) => (
            <button key={v} onClick={() => setViewPersist(v)} aria-pressed={view === v}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition", view === v && "bg-surface text-foreground shadow-sm")}>
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {leads.isLoading ? (
        <div className="flex gap-3 overflow-hidden">{STAGES.slice(0, 4).map((s) => <Skeleton key={s.id} className="h-[420px] w-[280px] shrink-0 rounded-2xl" />)}</div>
      ) : leads.error ? (
        <EmptyState title="Kunde inte ladda leads" description={errorMessage(leads.error)} />
      ) : !leads.data?.length ? (
        <EmptyState icon={<Users />} title="Inga leads ännu" description="Förfrågningar från ditt webbformulär hamnar här automatiskt. Du kan också skapa en lead manuellt."
          action={<div className="flex gap-2"><Button variant="outline" asChild><Link to="/app/kommunikation">Hämta formulärkod</Link></Button><Button variant="brand" onClick={() => setParams({ ny: "1" })}><Plus />Ny lead</Button></div>} />
      ) : view === "board" ? (
        <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            {STAGES.map((s) => <Column key={s.id} stage={s} leads={filtered.filter((l) => l.stage === s.id)} onMove={move} />)}
          </div>
          <DragOverlay dropAnimation={{ duration: 300, easing: "cubic-bezier(0.16,1,0.3,1)" }}>{active ? <LeadCard lead={active} onMove={move} overlay /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>{["Kund", "Tjänst", "Steg", "Källa", "Prioritet", "Värde", "Inkom"].map((h) => <th key={h} className="label-mono px-4 py-3 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3"><Link to={`/app/leads/${l.id}`} className="font-medium hover:text-brand">{l.customers?.name}</Link><p className="text-xs text-muted-foreground">{l.customers?.email}</p></td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">{l.ai_category ?? l.requested_service ?? "–"}</td>
                    <td className="px-4 py-3"><Badge tone={l.stage === "won" ? "success" : l.stage === "lost" ? "neutral" : "brand"}>{stageLabel(l.stage)}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{SOURCES[l.source]}</td>
                    <td className="px-4 py-3">{l.ai_priority ? <Badge tone={PRIORITY[l.ai_priority].tone}>{PRIORITY[l.ai_priority].label}</Badge> : "–"}</td>
                    <td className="px-4 py-3 font-mono tabular">{l.estimated_value ? formatSEK(l.estimated_value) : "–"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{relativeTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <NewLeadDialog open={newOpen} onOpenChange={(o) => setParams(o ? { ny: "1" } : {})} />
    </div>
  );
}
