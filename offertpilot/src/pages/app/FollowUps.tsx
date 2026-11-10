import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, CheckCircle2, Clock, Lock, Send, Settings2, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import type { FollowUpTask } from "@/lib/types";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { useAiTask, useInvalidate, useTasks } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";

const KIND: Record<FollowUpTask["kind"], string> = {
  lead_response: "Obesvarad förfrågan", quote_followup: "Offertuppföljning", custom: "Egen uppgift", agreement_renewal: "Avtal löper ut",
  recurring_order: "Återkommande order", inactive_customer: "Inaktiv kund", order_approval: "Order att godkänna",
};
/** Kund och länk för en uppgift – leads för offertflödet, kund/order för avtalskunder. */
const taskCustomer = (t: FollowUpTask) => t.leads?.customers ?? t.customers ?? null;
const taskLink = (t: FollowUpTask) => t.lead_id ? `/app/leads/${t.lead_id}` : t.order_id ? `/app/bestallningar/${t.order_id}` : t.customer_id ? `/app/kunder/${t.customer_id}` : "/app/uppfoljning";
/** Uppgifter som hanteras genom att öppna ordern, inte genom att skicka meddelande. */
const OPEN_ONLY = new Set<FollowUpTask["kind"]>(["custom", "recurring_order", "order_approval"]);

function TaskRow({ t, onOpen }: { t: FollowUpTask; onOpen: (t: FollowUpTask) => void }) {
  const invalidate = useInvalidate();
  const overdue = t.status === "pending" && new Date(t.due_at) < new Date();
  const close = async (status: "done" | "dismissed") => {
    const { error } = await supabase.from("follow_up_tasks").update({ status, completed_at: new Date().toISOString() }).eq("id", t.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(status === "done" ? "Markerad som klar" : "Uppgiften ignorerades");
    invalidate("tasks", "tasks-due-count", "dashboard");
  };
  return (
    <Card interactive className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", overdue ? "bg-warning/15 text-warning" : t.status === "pending" ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground")}>
        {t.status === "pending" ? <Clock className="size-4" /> : <CheckCircle2 className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{t.title}</p>
          <Badge>{KIND[t.kind]}</Badge>
          {t.draft_body && t.status === "pending" && <Badge tone="brand"><Sparkles className="size-3" />Utkast klart</Badge>}
          {taskCustomer(t)?.opted_out && <Badge tone="danger">Kunden har avböjt</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <Link to={taskLink(t)} className="hover:text-foreground">{taskCustomer(t)?.name}{t.orders ? ` · ${t.orders.number}` : ""}</Link>
          {" · "}{t.status === "pending" ? <span className={cn(overdue && "font-medium text-warning")}>{overdue ? `Försenad sedan ${relativeTime(t.due_at).replace(/^för /, "")}` : `Förfaller ${formatDate(t.due_at)}`}</span> : `Avslutad ${relativeTime(t.completed_at)}`}
        </p>
      </div>
      {t.status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => close("dismissed")} aria-label="Ignorera"><X /></Button>
          <Button size="sm" variant="outline" onClick={() => close("done")}><CheckCircle2 />Klar</Button>
          {OPEN_ONLY.has(t.kind) ? (t.order_id && <Button size="sm" variant="brand" asChild><Link to={taskLink(t)}>Öppna order</Link></Button>)
            : <Button size="sm" variant="brand" onClick={() => onOpen(t)}><Send />Följ upp</Button>}
        </div>
      )}
    </Card>
  );
}

function ComposeDialog({ task, onClose }: { task: FollowUpTask | null; onClose: () => void }) {
  const { usage } = useOrg();
  const ai = useAiTask();
  const invalidate = useInvalidate();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const aiAllowed = !!usage?.features.ai_followups;
  const customer = task ? taskCustomer(task) : null;

  useEffect(() => {
    setSubject(task?.draft_subject ?? (task?.quotations ? `Uppföljning av offert ${task.quotations.number}` : task?.kind === "agreement_renewal" ? "Förnyelse av vårt avtal" : task?.kind === "inactive_customer" ? "Dags att beställa igen?" : "Angående din förfrågan"));
    setBody(task?.draft_body ?? "");
  }, [task]);

  const send = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const res = await callFunction<{ demo: boolean; message: string }>("send-message", { task_id: task.id, subject, body });
      res.demo ? toast.warning(res.message) : toast.success(res.message);
      invalidate("tasks", "tasks-due-count", "messages", "dashboard");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()} title="Följ upp med kunden" description={`Till ${customer?.email ?? (task?.lead_id ? "kunden saknar e-post" : "kundens primära kontaktperson")}. Inget skickas utan ditt klick.`} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Avbryt</Button><Button variant="brand" onClick={send} loading={busy} disabled={!body.trim() || (!!task?.lead_id && !customer?.email) || customer?.opted_out}><Send />Godkänn och skicka</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
          <p className="text-[13px] text-muted-foreground">{aiAllowed ? "Låt AI skriva ett personligt utkast baserat på historiken." : "AI-skrivna uppföljningar ingår i Professional."}</p>
          {aiAllowed ? (
            <Button size="sm" variant="outline" loading={ai.isPending} onClick={() => task && ai.mutate({ task: "followup_message", task_id: task.id }, {
              onSuccess: (r) => { if (r.draft) { setSubject(r.draft.subject); setBody(r.draft.body); } },
            })}><Sparkles />Skriv med AI</Button>
          ) : <Button size="sm" variant="outline" asChild><Link to="/app/installningar/fakturering"><Lock />Uppgradera</Link></Button>}
        </div>
        <Field label="Ämne"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Meddelande" hint="En rad om att kunden kan avböja fler utskick läggs till automatiskt."><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px]" placeholder="Hej! Jag ville höra hur du tycker att offerten ser ut…" /></Field>
      </div>
    </Dialog>
  );
}

export default function FollowUps() {
  const pending = useTasks({ status: "pending" });
  const closed = useTasks({ status: "closed" });
  const [open, setOpen] = useState<FollowUpTask | null>(null);
  const now = Date.now();
  const p = pending.data ?? [];
  const overdue = p.filter((t) => new Date(t.due_at).getTime() < now);
  const upcoming = p.filter((t) => new Date(t.due_at).getTime() >= now);

  const list = (rows: FollowUpTask[], empty: string) => rows.length ? <div className="space-y-2.5">{rows.map((t) => <TaskRow key={t.id} t={t} onOpen={setOpen} />)}</div>
    : <EmptyState icon={<BellRing />} title={empty} description="Påminnelser skapas automatiskt för obesvarade förfrågningar, skickade offerter, avtal som löper ut och kunder som inte beställt på länge." />;

  return (
    <div>
      <PageHeader title="Uppföljning" description="Påminnelser enligt dina regler. Varje utgående meddelande godkänns manuellt."
        actions={<Button variant="outline" asChild><Link to="/app/installningar/uppfoljning"><Settings2 />Regler</Link></Button>} />
      {pending.isLoading ? <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}</div> : (
        <Tabs defaultValue={overdue.length ? "overdue" : "upcoming"}>
          <TabsList>
            <TabsTrigger value="overdue">Försenade <span className="font-mono text-[11px] opacity-60">{overdue.length}</span></TabsTrigger>
            <TabsTrigger value="upcoming">Kommande <span className="font-mono text-[11px] opacity-60">{upcoming.length}</span></TabsTrigger>
            <TabsTrigger value="closed">Avslutade</TabsTrigger>
          </TabsList>
          <TabsContent value="overdue">{list(overdue, "Inget är försenat")}</TabsContent>
          <TabsContent value="upcoming">{list(upcoming, "Inga kommande uppföljningar")}</TabsContent>
          <TabsContent value="closed">{list(closed.data ?? [], "Inga avslutade uppgifter")}</TabsContent>
        </Tabs>
      )}
      <ComposeDialog task={open} onClose={() => setOpen(null)} />
    </div>
  );
}
