import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Code2, Copy, ExternalLink, FileStack, Inbox, Mail, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";
import { useOrg } from "@/hooks/useOrg";
import { useInvalidate } from "@/hooks/data";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface InboxRow { id: string; lead_id: string; direction: string; status: string; subject: string | null; body: string; created_at: string; leads: { title: string; customers: { name: string } | null } | null }

function InboxTab() {
  const { org } = useOrg();
  const rows = useQuery({
    queryKey: ["inbox", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("id,lead_id,direction,status,subject,body,created_at,leads(title,customers(name))")
        .eq("organization_id", org!.id).neq("direction", "internal").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as InboxRow[];
    },
  });
  if (rows.isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;
  // Senaste meddelandet per lead
  const latest = new Map<string, InboxRow & { count: number }>();
  for (const r of rows.data ?? []) {
    const cur = latest.get(r.lead_id);
    if (!cur) latest.set(r.lead_id, { ...r, count: 1 });
    else cur.count++;
  }
  const list = [...latest.values()];
  if (!list.length) return <EmptyState icon={<Inbox />} title="Inga konversationer ännu" description="När kunder skickar förfrågningar via formuläret eller du loggar e-post visas de här." />;
  return (
    <Card className="divide-y overflow-hidden">
      {list.map((m) => (
        <Link key={m.lead_id} to={`/app/leads/${m.lead_id}`} className="flex gap-4 p-4 transition-colors hover:bg-muted/40">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", m.direction === "inbound" ? "bg-brand" : "bg-transparent")} aria-label={m.direction === "inbound" ? "Senast från kund" : undefined} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium">{m.leads?.customers?.name ?? "Kund"} <span className="font-normal text-muted-foreground">· {m.leads?.title}</span></p>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{relativeTime(m.created_at)}</span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{m.direction === "outbound" ? "Ni: " : ""}{m.body}</p>
            <div className="mt-1.5 flex gap-1.5">
              {m.status === "draft" && <Badge tone="brand">Utkast väntar</Badge>}
              {m.status === "demo_not_sent" && <Badge tone="warning">Ej skickat (demo)</Badge>}
              <Badge>{m.count} meddelanden</Badge>
            </div>
          </div>
        </Link>
      ))}
    </Card>
  );
}

function TemplatesTab() {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ name: "", subject: "", body: "" });
  const rows = useQuery({
    queryKey: ["templates", org?.id],
    queryFn: async () => (await supabase.from("message_templates").select("*").eq("organization_id", org!.id).order("name")).data ?? [],
  });
  const add = async () => {
    if (!f.name.trim() || !f.body.trim()) return toast.error("Ange namn och text");
    const { error } = await supabase.from("message_templates").insert({ organization_id: org!.id, ...f });
    if (error) return toast.error(errorMessage(error));
    setF({ name: "", subject: "", body: "" });
    toast.success("Mall sparad");
    invalidate("templates");
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        {rows.data?.length ? rows.data.map((t) => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                {t.subject && <p className="text-xs text-muted-foreground">Ämne: {t.subject}</p>}
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted-foreground">{t.body}</p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Kopiera" onClick={() => { navigator.clipboard.writeText(t.body); toast.success("Kopierad"); }}><Copy /></Button>
                <Button size="icon" variant="ghost" aria-label="Ta bort" onClick={async () => { await supabase.from("message_templates").delete().eq("id", t.id); invalidate("templates"); }}><Trash2 /></Button>
              </div>
            </div>
          </Card>
        )) : <EmptyState icon={<FileStack />} title="Inga mallar" description="Spara återkommande svar, t.ex. bekräftelse på platsbesök." />}
      </div>
      <Card>
        <CardHeader title="Ny mall" />
        <CardBody className="space-y-4">
          <Field label="Namn"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bekräfta platsbesök" /></Field>
          <Field label="Ämne"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Text"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="min-h-[160px]" /></Field>
          <Button variant="brand" onClick={add} className="w-full"><Plus />Spara mall</Button>
        </CardBody>
      </Card>
    </div>
  );
}

function FormTab() {
  const { org } = useOrg();
  const url = `${window.location.origin}/forfragan/${org!.public_form_key}`;
  const iframe = `<iframe src="${url}?embed=1" title="Offertförfrågan – ${org!.name}" style="width:100%;min-height:640px;border:0;border-radius:16px" loading="lazy"></iframe>`;
  const script = `<div id="offertpilot-form"></div>\n<script src="${window.location.origin}/embed.js" data-form="${org!.public_form_key}" async></script>`;
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Koden är kopierad"); };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Bädda in på din webbplats" description="Förfrågningar skapar en lead direkt i Offertfabriken." />
        <CardBody className="space-y-5">
          {[["Skript (rekommenderas, anpassar höjden)", script], ["Iframe", iframe], ["Direktlänk", url]].map(([label, code]) => (
            <div key={label}>
              <div className="mb-1.5 flex items-center justify-between"><p className="label-mono">{label}</p><Button size="sm" variant="ghost" onClick={() => copy(code)}><Copy />Kopiera</Button></div>
              <pre className="overflow-x-auto rounded-xl border bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed"><code>{code}</code></pre>
            </div>
          ))}
          <Button variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink />Öppna formuläret</a></Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Skydd och integritet" />
        <CardBody>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {["Validering av alla fält på servern", "Dolt honeypot-fält och minsta ifyllnadstid mot botar", "Begränsning: 5 förfrågningar per 10 minuter och IP, 100 per timme och formulär", "Samtycke till personuppgiftsbehandling krävs", "IP-adresser lagras endast som saltade hashvärden för rate limiting", "Kundtext behandlas alltid som data – instruktioner i meddelanden ignoreras av AI:n"].map((x) => (
              <li key={x} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />{x}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function EmailTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Mail className="size-4" />Utgående e-post</span>} />
        <CardBody className="space-y-3 text-sm text-muted-foreground">
          <p>Offerter, svar och uppföljningar skickas via <span className="text-foreground">Resend</span> från serversidan. Svar från kunden går till adressen du anger under <Link to="/app/installningar/epost" className="text-brand hover:underline">E-postinställningar</Link>.</p>
          <p>Om e-post inte är konfigurerad körs <Badge tone="warning">Demoläge</Badge> – inget skickas och du får tydligt besked. Ladda då ner PDF:en och skicka den själv.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Inkommande e-post" description="Planerad integration" />
        <CardBody className="space-y-3 text-sm text-muted-foreground">
          <p>Arkitekturen stöder kanalen <span className="font-mono text-xs">email</span> för konversationer. Automatisk import av inkommande mejl (vidarebefordran eller Gmail/Outlook-koppling) är ännu inte aktiverad.</p>
          <p>Tills vidare: logga kundens svar med <span className="text-foreground">“Kundens svar”</span> i konversationen på en lead.</p>
        </CardBody>
      </Card>
    </div>
  );
}

export default function Communication() {
  return (
    <div>
      <PageHeader title="Kommunikation" description="Alla kundkonversationer, mallar och ditt webbformulär på ett ställe." />
      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox"><Inbox />Konversationer</TabsTrigger>
          <TabsTrigger value="templates"><FileStack />Mallar</TabsTrigger>
          <TabsTrigger value="form"><Code2 />Webbformulär</TabsTrigger>
          <TabsTrigger value="email"><Mail />E-post</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox"><InboxTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="form"><FormTab /></TabsContent>
        <TabsContent value="email"><EmailTab /></TabsContent>
      </Tabs>
    </div>
  );
}
