import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, BellRing, CheckCircle2, Clock, FileText, Inbox, Plus, Sparkles, TrendingUp, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/hooks/useOrg";
import { formatSEK } from "@shared/pricing.ts";
import { ACTIVITY, STAGES } from "@/lib/labels";
import type { Activity, LeadStage } from "@/lib/types";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";

interface Stats {
  total_leads: number; new_leads_30d: number; new_leads_prev_30d: number; leads_in_new: number; active_quotes: number;
  pending_approval: number; accepted_quotes: number; accepted_value: number; pipeline_value: number; won_leads: number;
  lost_leads: number; pending_followups: number; overdue_followups: number; stages: Partial<Record<LeadStage, number>>;
  weekly: { week: string; leads: number; quoted: number; won_value: number }[]; sources: Record<string, number>;
}

function Stat({ label, value, sub, icon: Icon, to, tone }: { label: string; value: string; sub?: React.ReactNode; icon: typeof Users; to: string; tone?: "warning" }) {
  return (
    <Link to={to} className="group">
      <Card interactive className="h-full p-5">
        <div className="flex items-center justify-between">
          <span className="label-mono">{label}</span>
          <Icon className={cn("size-4 text-muted-foreground transition-colors group-hover:text-brand", tone === "warning" && "text-warning")} />
        </div>
        <p className="mt-4 text-[28px] font-semibold tracking-tight tabular">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </Card>
    </Link>
  );
}

const chartTooltip = {
  contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" },
  labelStyle: { color: "hsl(var(--muted-foreground))", marginBottom: 4 },
};

export default function Dashboard() {
  const { org, usage } = useOrg();
  const qc = useQueryClient();

  // Skapa påminnelser för obesvarade leads och markera utgångna offerter
  useEffect(() => {
    if (!org) return;
    supabase.rpc("refresh_follow_ups", { org: org.id }).then(({ data }) => {
      if (data) qc.invalidateQueries({ queryKey: ["tasks-due-count"] });
    });
  }, [org, qc]);

  const stats = useQuery({
    queryKey: ["dashboard", org?.id],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_stats", { org: org!.id });
      if (error) throw error;
      return data as Stats;
    },
  });
  const activity = useQuery({
    queryKey: ["activity", org?.id],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await supabase.from("activity_logs").select("*").eq("organization_id", org!.id).order("created_at", { ascending: false }).limit(12);
      if (error) throw error;
      return data as Activity[];
    },
  });

  const s = stats.data;
  const closed = (s?.won_leads ?? 0) + (s?.lost_leads ?? 0);
  const conversion = closed ? Math.round(((s?.won_leads ?? 0) / closed) * 100) : null;
  const delta = s ? s.new_leads_30d - s.new_leads_prev_30d : 0;
  const weekly = (s?.weekly ?? []).map((w) => ({ ...w, label: formatDate(w.week, { day: "numeric", month: "short" }) }));
  const maxStage = Math.max(1, ...STAGES.map((x) => s?.stages[x.id] ?? 0));
  const analytics = usage?.features.analytics;

  return (
    <div>
      <PageHeader
        eyebrow={formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}
        title={`Översikt`}
        description="Allt som händer i din försäljning, baserat på dina riktiga leads och offerter."
        actions={<><Button variant="outline" asChild><Link to="/app/kommunikation"><Inbox />Webbformulär</Link></Button><Button variant="brand" asChild><Link to="/app/leads?ny=1"><Plus />Ny lead</Link></Button></>}
      />

      {stats.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)}</div>
      ) : stats.error ? (
        <EmptyState title="Kunde inte ladda översikten" description="Försök att ladda om sidan." />
      ) : s && (
        <>
          {s.total_leads === 0 && (
            <Card className="mb-6 overflow-hidden border-brand/20 bg-gradient-to-br from-brand-soft via-card to-card">
              <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white"><Sparkles className="size-5" /></div>
                  <div>
                    <h3 className="font-semibold tracking-tight">Ta emot din första förfrågan</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">Lägg in webbformuläret på din sajt eller skapa en lead manuellt för att se AI:n i arbete.</p>
                  </div>
                </div>
                <div className="flex gap-2"><Button variant="outline" asChild><Link to="/app/kunskapsbas">Lägg till tjänster</Link></Button><Button variant="brand" asChild><Link to="/app/leads?ny=1">Skapa lead</Link></Button></div>
              </CardBody>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Förfrågningar" value={String(s.total_leads)} icon={Users} to="/app/leads"
              sub={<><span className={cn(delta > 0 && "text-success", delta < 0 && "text-destructive")}>{delta > 0 ? "+" : ""}{delta}</span> jämfört med föregående 30 dagar</>} />
            <Stat label="Nya leads" value={String(s.leads_in_new)} icon={Inbox} to="/app/leads" sub={`${s.new_leads_30d} senaste 30 dagarna`} />
            <Stat label="Aktiva offerter" value={String(s.active_quotes)} icon={FileText} to="/app/offerter" sub={`${s.accepted_quotes} accepterade totalt`} />
            <Stat label="Väntar på godkännande" value={String(s.pending_approval)} icon={Clock} to="/app/offerter?status=pending_approval" tone={s.pending_approval ? "warning" : undefined} sub="Kräver en administratör" />
            <Stat label="Pipelinevärde" value={formatSEK(s.pipeline_value)} icon={TrendingUp} to="/app/leads" sub="Öppna affärer, inkl. moms" />
            <Stat label="Vunnet värde" value={formatSEK(s.accepted_value)} icon={CheckCircle2} to="/app/offerter?status=accepted" sub="Accepterade offerter" />
            <Stat label="Konvertering" value={conversion === null ? "–" : `${conversion} %`} icon={ArrowUpRight} to="/app/leads" sub={closed ? `${s.won_leads} vunna av ${closed} avslutade` : "Inga avslutade affärer ännu"} />
            <Stat label="Uppföljningar" value={String(s.pending_followups)} icon={BellRing} to="/app/uppfoljning" tone={s.overdue_followups ? "warning" : undefined} sub={s.overdue_followups ? `${s.overdue_followups} försenade` : "Inga försenade"} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Inflöde av förfrågningar" description="Antal nya leads per vecka, senaste 12 veckorna" />
              <CardBody className="h-[260px] pt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weekly} margin={{ left: -24, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip {...chartTooltip} formatter={(v) => [v as number, "Leads"]} />
                    <Area type="monotone" dataKey="leads" stroke="hsl(var(--brand))" strokeWidth={2} fill="url(#leadsFill)" activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Pipeline" description="Leads per steg" action={<Link to="/app/leads" className="text-xs text-brand hover:underline">Öppna tavla</Link>} />
              <CardBody className="space-y-3 pt-6">
                {STAGES.map((st) => {
                  const n = s.stages[st.id] ?? 0;
                  return (
                    <Link key={st.id} to="/app/leads" className="group block">
                      <div className="mb-1 flex justify-between text-[13px]"><span className="text-muted-foreground group-hover:text-foreground">{st.label}</span><span className="font-mono tabular">{n}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", st.id === "won" ? "bg-success" : st.id === "lost" ? "bg-muted-foreground/40" : "bg-brand")} style={{ width: `${(n / maxStage) * 100}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </CardBody>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card className="relative overflow-hidden">
              <CardHeader title="Offererat och vunnet" description="Värde inkl. moms per vecka" />
              <CardBody className={cn("h-[260px] pt-6", !analytics && "pointer-events-none select-none blur-[3px]")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekly} margin={{ left: 0, right: 8, top: 8 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)} tkr` : String(v))} />
                    <Tooltip {...chartTooltip} cursor={{ fill: "hsl(var(--muted))" }} formatter={(v, n) => [formatSEK(v as number), n === "quoted" ? "Offererat" : "Vunnet"]} />
                    <Bar dataKey="quoted" fill="hsl(var(--brand) / 0.35)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="won_value" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
              {!analytics && (
                <div className="absolute inset-0 top-16 grid place-items-center">
                  <div className="rounded-xl border bg-popover/95 p-4 text-center shadow-lg">
                    <p className="text-sm font-medium">Avancerad analys ingår i Professional</p>
                    <Button size="sm" variant="brand" className="mt-3" asChild><Link to="/app/installningar/fakturering">Se planer</Link></Button>
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Senaste aktivitet" />
              <CardBody className="pt-4">
                {activity.isLoading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
                  : !activity.data?.length ? <p className="py-8 text-center text-sm text-muted-foreground">Ingen aktivitet ännu.</p>
                  : (
                    <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[5px] before:w-px before:bg-border">
                      {activity.data.map((a) => {
                        const title = (a.details.title ?? a.details.number) as string | undefined;
                        const href = a.entity_type === "lead" && a.entity_id ? `/app/leads/${a.entity_id}` : a.entity_type === "quotation" && a.entity_id ? `/app/offerter/${a.entity_id}` : undefined;
                        const content = (
                          <>
                            <p className="text-[13px] font-medium">{ACTIVITY[a.action] ?? a.action}</p>
                            <p className="truncate text-xs text-muted-foreground">{title ? `${title} · ` : ""}{relativeTime(a.created_at)}</p>
                          </>
                        );
                        return (
                          <li key={a.id} className="relative pl-6">
                            <span className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-card bg-brand" />
                            {href ? <Link to={href} className="block hover:opacity-80">{content}</Link> : content}
                          </li>
                        );
                      })}
                    </ol>
                  )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
