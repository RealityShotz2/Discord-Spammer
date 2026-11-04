import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle, ArrowLeft, BellPlus, Building2, CheckCircle2, Download, FilePlus2, FileText, HelpCircle, Lightbulb, Mail, MapPin,
  MessageSquare, Phone, Send, ShieldOff, Sparkles, StickyNote, Trash2, UserX, Wand2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import { PRIORITY, QUOTE_STATUS, SOURCES, STAGES } from "@/lib/labels";
import type { LeadStage, Message } from "@/lib/types";
import { formatSEK } from "@shared/pricing.ts";
import { cn, downloadBlob, formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import { useAiTask, useInvalidate, useLead, useLeadMessages, useQuotations, useTasks } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { AiBadge, Badge, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";

function MessageBubble({ m, onSent }: { m: Message; onSent: () => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(m.subject ?? "");
  const [body, setBody] = useState(m.body);
  const [busy, setBusy] = useState(false);
  const inbound = m.direction === "inbound";
  const internal = m.direction === "internal";

  const save = async () => {
    const { error } = await supabase.from("messages").update({ subject, body }).eq("id", m.id);
    if (error) return toast.error(errorMessage(error));
    setEditing(false);
    onSent();
  };
  const send = async () => {
    setBusy(true);
    try {
      if (editing) await save();
      const res = await callFunction<{ demo: boolean; message: string }>("send-message", { message_id: m.id });
      res.demo ? toast.warning(res.message) : toast.success(res.message);
      onSent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const { error } = await supabase.from("messages").delete().eq("id", m.id);
    if (error) return toast.error(errorMessage(error));
    onSent();
  };

  return (
    <div className={cn("flex", inbound ? "justify-start" : "justify-end")}>
      <div className={cn("w-full max-w-[560px] rounded-2xl border p-4",
        inbound ? "rounded-tl-md bg-card" : internal ? "border-dashed bg-muted/40" : m.status === "draft" ? "rounded-tr-md border-brand/40 bg-brand-soft/40" : "rounded-tr-md bg-accent/60")}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{inbound ? "Kund" : internal ? "Intern anteckning" : "Ni"}</span>
          <span>·</span><span>{formatDateTime(m.sent_at ?? m.created_at)}</span>
          {m.status === "draft" && <Badge tone="brand">Utkast</Badge>}
          {m.status === "demo_not_sent" && <Badge tone="warning">Ej skickat (demoläge)</Badge>}
          {m.status === "sent" && !inbound && <Badge tone="success">Skickat</Badge>}
          {m.ai_generated && <AiBadge source="ai" />}
        </div>
        {editing ? (
          <div className="space-y-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ämne" />
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[200px]" />
          </div>
        ) : (
          <>
            {m.subject && <p className="mb-1 text-sm font-medium">{m.subject}</p>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
          </>
        )}
        {m.status === "draft" && (
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button size="sm" variant="ghost" onClick={remove}><Trash2 />Ta bort</Button>
            {editing ? <Button size="sm" variant="outline" onClick={save}>Spara</Button> : <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Redigera</Button>}
            <Button size="sm" variant="brand" onClick={send} loading={busy}><Send />Godkänn och skicka</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { org, isAdmin } = useOrg();
  const lead = useLead(id);
  const messages = useLeadMessages(id);
  const quotes = useQuotations({ leadId: id });
  const tasks = useTasks({ leadId: id });
  const ai = useAiTask();
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"internal" | "inbound">("internal");
  const [taskOpen, setTaskOpen] = useState(false);
  const [anonOpen, setAnonOpen] = useState(false);

  if (lead.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  if (!lead.data) return <EmptyState title="Leaden hittades inte" description="Den kan ha raderats eller tillhöra ett annat företag." action={<Button asChild variant="outline"><Link to="/app/leads">Till leads</Link></Button>} />;
  const l = lead.data;
  const c = l.customers;
  const refresh = () => invalidate("lead", "leads", "messages", "tasks", "quotations", "dashboard");

  const update = async (patch: Record<string, unknown>, msg?: string) => {
    const { error } = await supabase.from("leads").update(patch).eq("id", l.id);
    if (error) return toast.error(errorMessage(error));
    if (msg) toast.success(msg);
    refresh();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    const channel = noteKind === "internal" ? "note" : "email";
    let { data: conv } = await supabase.from("conversations").select("id").eq("lead_id", l.id).eq("channel", channel).maybeSingle();
    if (!conv) ({ data: conv } = await supabase.from("conversations").insert({ organization_id: l.organization_id, lead_id: l.id, channel }).select("id").single());
    const { error } = await supabase.from("messages").insert({ organization_id: l.organization_id, conversation_id: conv!.id, lead_id: l.id, direction: noteKind, status: "received", body: note.trim() });
    if (error) return toast.error(errorMessage(error));
    setNote("");
    toast.success(noteKind === "internal" ? "Anteckning sparad" : "Kundens svar loggat");
    refresh();
  };

  const draftQuote = () => ai.mutate({ task: "draft_quotation", lead_id: l.id }, {
    onSuccess: (r) => { toast.success("Offertutkast skapat – granska innan godkännande"); navigate(`/app/offerter/${r.quotation_id}`); },
  });

  const emptyQuote = async () => {
    const { data, error } = await supabase.from("quotations").insert({ organization_id: l.organization_id, lead_id: l.id, customer_id: l.customer_id, title: l.requested_service ?? l.title }).select("id").single();
    if (error) return toast.error(errorMessage(error));
    if (["new", "qualification"].includes(l.stage)) await supabase.from("leads").update({ stage: "quote_draft" }).eq("id", l.id);
    navigate(`/app/offerter/${data.id}`);
  };

  const exportCustomer = async () => {
    const { data, error } = await supabase.rpc("export_customer_data", { cid: c.id });
    if (error) return toast.error(errorMessage(error));
    downloadBlob(JSON.stringify(data, null, 2), `kunddata-${c.name.replace(/\W+/g, "-")}.json`, "application/json");
    toast.success("Kunddata exporterad");
  };

  return (
    <div>
      <Link to="/app/leads" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />Alla leads</Link>

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>{SOURCES[l.source]}</Badge>
            {l.ai_priority && <Badge tone={PRIORITY[l.ai_priority].tone} dot>Prioritet: {PRIORITY[l.ai_priority].label}</Badge>}
            <span className="font-mono text-[11px] text-muted-foreground">Inkom {formatDateTime(l.created_at)}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{c?.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{l.ai_category ?? l.requested_service ?? l.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Steg" value={l.stage} onChange={(e) => update({ stage: e.target.value as LeadStage, position: Date.now() / 1000 }, "Steg uppdaterat")} className="w-auto min-w-[180px]">
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Button variant="brand" onClick={draftQuote} loading={ai.isPending && ai.variables?.task === "draft_quotation"}><Wand2 />Skapa offert med AI</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* AI-analys */}
          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b bg-gradient-to-r from-brand-soft/70 to-transparent p-5">
              <div className="flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-white"><Sparkles className="size-4" /></div>
                <div>
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">AI-analys <AiBadge source={l.ai_source} /></h3>
                  <p className="text-[13px] text-muted-foreground">{l.ai_analyzed_at ? `Analyserad ${relativeTime(l.ai_analyzed_at)}` : "Låt AI sammanfatta förfrågan och föreslå nästa steg."}</p>
                </div>
              </div>
              <Button size="sm" variant={l.ai_analyzed_at ? "outline" : "brand"} onClick={() => ai.mutate({ task: "analyze_lead", lead_id: l.id }, { onSuccess: () => toast.success("Analysen är klar") })} loading={ai.isPending && ai.variables?.task === "analyze_lead"}>
                <Sparkles />{l.ai_analyzed_at ? "Analysera igen" : "Analysera"}
              </Button>
            </div>
            {l.ai_analyzed_at ? (
              <CardBody className="grid gap-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <p className="label-mono mb-1.5">Sammanfattning</p>
                  <p className="text-sm leading-relaxed">{l.ai_summary}</p>
                </div>
                <div>
                  <p className="label-mono mb-2 flex items-center gap-1.5"><AlertCircle className="size-3.5" />Saknas för offert</p>
                  {l.ai_missing_info?.length ? <ul className="space-y-1.5 text-sm">{l.ai_missing_info.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-warning" />{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">Inget – underlaget räcker.</p>}
                </div>
                <div>
                  <p className="label-mono mb-2 flex items-center gap-1.5"><HelpCircle className="size-3.5" />Följdfrågor</p>
                  {l.ai_questions?.length ? <ol className="space-y-1.5 text-sm">{l.ai_questions.map((x, i) => <li key={x} className="flex gap-2"><span className="font-mono text-xs text-muted-foreground">{i + 1}.</span>{x}</li>)}</ol> : <p className="text-sm text-muted-foreground">Inga.</p>}
                </div>
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex gap-2 text-sm"><Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" /><span><span className="font-medium">Nästa steg: </span>{l.ai_next_action}</span></p>
                  <Button size="sm" variant="outline" onClick={() => ai.mutate({ task: "reply_draft", lead_id: l.id }, { onSuccess: () => toast.success("Svarsutkast skapat nedan") })} loading={ai.isPending && ai.variables?.task === "reply_draft"}><Mail />Skriv svar med frågorna</Button>
                </div>
              </CardBody>
            ) : (
              <CardBody><p className="text-sm text-muted-foreground">Ingen analys ännu.</p></CardBody>
            )}
          </Card>

          {/* Konversation */}
          <Card>
            <CardHeader title="Konversation" description="Förfrågan, svar, utkast och interna anteckningar" />
            <CardBody className="space-y-4">
              {l.message && !messages.data?.some((m) => m.direction === "inbound" && m.body === l.message) && (
                <MessageBubble m={{ id: "orig", conversation_id: "", lead_id: l.id, direction: "inbound", status: "received", subject: l.requested_service, body: l.message, ai_generated: false, sent_at: null, created_at: l.created_at }} onSent={refresh} />
              )}
              {messages.isLoading ? <Skeleton className="h-24" /> : messages.data?.map((m) => <MessageBubble key={m.id} m={m} onSent={refresh} />)}
              <div className="rounded-2xl border bg-muted/30 p-3">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={noteKind === "internal" ? "Skriv en intern anteckning…" : "Klistra in kundens svar…"} className="min-h-[72px] border-0 bg-transparent shadow-none focus:ring-0" />
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div className="inline-flex rounded-lg border bg-surface p-0.5 text-xs">
                    <button onClick={() => setNoteKind("internal")} className={cn("flex items-center gap-1 rounded-md px-2 py-1", noteKind === "internal" && "bg-accent font-medium")}><StickyNote className="size-3.5" />Anteckning</button>
                    <button onClick={() => setNoteKind("inbound")} className={cn("flex items-center gap-1 rounded-md px-2 py-1", noteKind === "inbound" && "bg-accent font-medium")}><MessageSquare className="size-3.5" />Kundens svar</button>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => ai.mutate({ task: "reply_draft", lead_id: l.id })} loading={ai.isPending && ai.variables?.task === "reply_draft"}><Sparkles />AI-svar</Button>
                    <Button size="sm" onClick={addNote} disabled={!note.trim()}>Spara</Button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Kund" action={c.anonymized_at ? <Badge>Anonymiserad</Badge> : null} />
            <CardBody className="space-y-3 text-sm">
              {c.company_name && <p className="flex items-center gap-2.5"><Building2 className="size-4 text-muted-foreground" />{c.company_name}</p>}
              {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2.5 hover:text-brand"><Mail className="size-4 text-muted-foreground" />{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2.5 hover:text-brand"><Phone className="size-4 text-muted-foreground" />{c.phone}</a>}
              {c.city && <p className="flex items-center gap-2.5"><MapPin className="size-4 text-muted-foreground" />{c.city}</p>}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="flex items-center gap-2 text-[13px]"><ShieldOff className="size-4 text-muted-foreground" />Avböjt utskick</span>
                <Switch label="Avböjt utskick" checked={c.opted_out} onCheckedChange={async (v) => {
                  const { error } = await supabase.from("customers").update({ opted_out: v }).eq("id", c.id);
                  if (error) return toast.error(errorMessage(error));
                  toast.success(v ? "Uppföljningar stoppade för kunden" : "Kunden kan få utskick igen");
                  refresh();
                }} />
              </div>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={exportCustomer}><Download />Exportera (GDPR)</Button>
                {isAdmin && !c.anonymized_at && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setAnonOpen(true)}><UserX />Radera persondata</Button>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Offerter" action={<Button size="sm" variant="ghost" onClick={emptyQuote}><FilePlus2 />Tom offert</Button>} />
            <CardBody className="space-y-2">
              {quotes.data?.length ? quotes.data.map((q) => (
                <Link key={q.id} to={`/app/offerter/${q.id}`} className="flex items-center justify-between rounded-xl border p-3 transition hover:border-brand/30 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <FileText className="size-4 text-muted-foreground" />
                    <div><p className="text-sm font-medium">{q.number}</p><p className="text-xs text-muted-foreground">{formatSEK(q.total)}</p></div>
                  </div>
                  <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
                </Link>
              )) : <p className="py-2 text-sm text-muted-foreground">Ingen offert ännu.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Uppföljning" action={<Button size="sm" variant="ghost" onClick={() => setTaskOpen(true)}><BellPlus />Ny</Button>} />
            <CardBody className="space-y-2">
              {tasks.data?.filter((t) => t.status === "pending").length ? tasks.data.filter((t) => t.status === "pending").map((t) => (
                <Link key={t.id} to="/app/uppfoljning" className="flex items-start gap-3 rounded-xl border p-3 transition hover:bg-muted/40">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", new Date(t.due_at) < new Date() ? "bg-warning animate-pulse-dot" : "bg-brand")} />
                  <div><p className="text-sm">{t.title}</p><p className="text-xs text-muted-foreground">{new Date(t.due_at) < new Date() ? "Försenad · " : ""}{formatDate(t.due_at)}</p></div>
                </Link>
              )) : <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4" />Inget att följa upp.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Affärsvärde" />
            <CardBody>
              <EstimatedValue value={l.estimated_value === null ? null : Number(l.estimated_value)} onSave={(v) => update({ estimated_value: v }, "Värde uppdaterat")} />
            </CardBody>
          </Card>
        </div>
      </div>

      <NewTaskDialog open={taskOpen} onOpenChange={setTaskOpen} leadId={l.id} orgId={org!.id} onCreated={refresh} />
      <Dialog open={anonOpen} onOpenChange={setAnonOpen} title="Radera kundens personuppgifter?"
        description="Namn, kontaktuppgifter, meddelanden och AI-analyser tas bort permanent. Offertbelopp sparas anonymt för bokföringen. Åtgärden kan inte ångras."
        footer={<><Button variant="ghost" onClick={() => setAnonOpen(false)}>Avbryt</Button><Button variant="destructive" onClick={async () => {
          const { error } = await supabase.rpc("anonymize_customer", { cid: c.id });
          if (error) return toast.error(errorMessage(error));
          setAnonOpen(false);
          toast.success("Personuppgifterna är raderade");
          refresh();
        }}>Radera permanent</Button></>} />
    </div>
  );
}

function EstimatedValue({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value?.toString() ?? "");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v ? Number(v.replace(/\s/g, "").replace(",", ".")) : null); }}>
      <Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder="Uppskattat värde i kr" aria-label="Uppskattat värde" />
      <Button type="submit" variant="outline">Spara</Button>
    </form>
  );
}

function NewTaskDialog({ open, onOpenChange, leadId, orgId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; orgId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("Ring kunden");
  const [due, setDue] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ny uppföljning"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" onClick={async () => {
        const { error } = await supabase.from("follow_up_tasks").insert({ organization_id: orgId, lead_id: leadId, kind: "custom", title, due_at: new Date(`${due}T09:00:00`).toISOString() });
        if (error) return toast.error(errorMessage(error));
        toast.success("Uppföljning skapad");
        onOpenChange(false);
        onCreated();
      }}>Skapa</Button></>}>
      <div className="grid gap-4">
        <Field label="Vad ska göras?"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Datum"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
