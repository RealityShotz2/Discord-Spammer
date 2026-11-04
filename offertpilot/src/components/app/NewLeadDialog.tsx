import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { SOURCES } from "@/lib/labels";
import type { LeadSource } from "@/lib/types";
import { useOrgId } from "@/hooks/useOrg";
import { useInvalidate, useServices } from "@/hooks/data";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

export function NewLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useOrgId();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const services = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", company_name: "", city: "", service: "", message: "", source: "manual" as LeadSource, estimated_value: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 1) return setError("Ange kundens namn.");
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setError("E-postadressen är ogiltig.");
    if (!f.message.trim()) return setError("Beskriv vad kunden vill ha hjälp med.");
    setBusy(true);
    try {
      let customerId: string | null = null;
      if (f.email) {
        const { data } = await supabase.from("customers").select("id").eq("organization_id", org).eq("email", f.email.trim().toLowerCase()).is("anonymized_at", null).limit(1).maybeSingle();
        customerId = data?.id ?? null;
      }
      if (!customerId) {
        const { data, error } = await supabase.from("customers").insert({
          organization_id: org, name: f.name.trim(), email: f.email.trim().toLowerCase() || null, phone: f.phone || null, company_name: f.company_name || null, city: f.city || null,
        }).select("id").single();
        if (error) throw error;
        customerId = data.id;
      }
      const { data: lead, error } = await supabase.from("leads").insert({
        organization_id: org, customer_id: customerId, source: f.source,
        title: `${f.service || "Förfrågan"} – ${f.name.trim()}`.slice(0, 200),
        requested_service: f.service || null, message: f.message.trim(),
        estimated_value: f.estimated_value ? Number(f.estimated_value.replace(/\s/g, "").replace(",", ".")) : null,
      }).select("id").single();
      if (error) throw error;
      const channel = f.source === "phone" ? "phone" : f.source === "email" ? "email" : "note";
      const { data: conv } = await supabase.from("conversations").insert({ organization_id: org, lead_id: lead.id, channel, subject: f.service || null }).select("id").single();
      if (conv) await supabase.from("messages").insert({ organization_id: org, conversation_id: conv.id, lead_id: lead.id, direction: "inbound", status: "received", body: f.message.trim(), subject: f.service || null });
      await invalidate("leads", "dashboard");
      toast.success("Lead skapad");
      onOpenChange(false);
      navigate(`/app/leads/${lead.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ny lead" description="Registrera en förfrågan som kommit via telefon, e-post eller besök." className="max-w-xl"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button><Button variant="brand" type="submit" form="new-lead" loading={busy}>Skapa lead</Button></>}>
      <form id="new-lead" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Kundens namn *"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Företag"><Input value={f.company_name} onChange={set("company_name")} placeholder="Valfritt" /></Field>
        <Field label="E-post"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Efterfrågad tjänst">
          <Input list="svc-list" value={f.service} onChange={set("service")} placeholder="Badrumsrenovering" />
          <datalist id="svc-list">{services.data?.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        </Field>
        <Field label="Ort"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Källa"><Select value={f.source} onChange={set("source")}>{Object.entries(SOURCES).filter(([k]) => k !== "website").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Uppskattat värde (kr)" hint="Valfritt, för pipeline"><Input inputMode="numeric" value={f.estimated_value} onChange={set("estimated_value")} /></Field>
        <Field label="Kundens förfrågan *" className="sm:col-span-2"><Textarea value={f.message} onChange={set("message")} placeholder="Vad vill kunden ha hjälp med? Klistra in mejlet eller anteckna samtalet." /></Field>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
      </form>
    </Dialog>
  );
}
