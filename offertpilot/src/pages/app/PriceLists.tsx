import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Lock, Plus, Search, Star, Tags } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { useCustomers, usePriceLists } from "@/hooks/business";
import { useInvalidate } from "@/hooks/data";
import { useOrg } from "@/hooks/useOrg";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";

type Filter = "all" | "standard" | "customer" | "inactive";

export default function PriceLists() {
  const { org, isAdmin } = useOrg();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const lists = usePriceLists();
  const customers = useCustomers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ name: "", description: "", customer_id: "", valid_from: "", valid_to: "" });
  const [dupName, setDupName] = useState("");
  const [dupCustomer, setDupCustomer] = useState("");

  const visible = (lists.data ?? []).filter((l) =>
    (filter === "all" || (filter === "standard" && !l.customer_id && l.active) || (filter === "customer" && !!l.customer_id) || (filter === "inactive" && !l.active))
    && (!q.trim() || [l.name, l.description, l.customers?.name].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast.error("Ange ett namn");
    const first = !(lists.data ?? []).some((l) => l.is_default);
    const { data, error } = await supabase.from("price_lists").insert({
      organization_id: org!.id, name: f.name.trim(), description: f.description || null, customer_id: f.customer_id || null,
      is_default: first && !f.customer_id, valid_from: f.valid_from || null, valid_to: f.valid_to || null,
    }).select("id").single();
    if (error) return toast.error(errorMessage(error));
    invalidate("price_lists");
    setNewOpen(false);
    navigate(`/app/prislistor/${data.id}`);
  };
  const duplicate = async () => {
    if (!dup) return;
    const { data, error } = await supabase.rpc("duplicate_price_list", { pl: dup.id, new_name: dupName, for_customer: dupCustomer || null });
    if (error) return toast.error(errorMessage(error));
    toast.success("Prislistan är duplicerad");
    invalidate("price_lists");
    setDup(null);
    navigate(`/app/prislistor/${data}`);
  };

  return (
    <div>
      <PageHeader title="Prislistor" description="Fasta priser per kg, styck, timme, pall eller annan enhet – med mängdrabatter och kundspecifika listor. Ett tillägg till din tjänstekatalog, som fungerar som tidigare."
        actions={isAdmin ? <Button variant="brand" onClick={() => setNewOpen(true)}><Plus />Ny prislista</Button> : <Badge><Lock className="size-3" />Endast administratörer kan ändra</Badge>} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök prislista eller kund…" className="pl-9" aria-label="Sök prislistor" />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1" role="tablist">
          {([["all", "Alla"], ["standard", "Gemensamma"], ["customer", "Kundspecifika"], ["inactive", "Inaktiva"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
              className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition", filter === id && "bg-surface text-foreground shadow-sm")}>{label}</button>
          ))}
        </div>
      </div>

      {lists.isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
        : !visible.length ? (
          <EmptyState icon={<Tags />} title={lists.data?.length ? "Inga prislistor matchar" : "Inga prislistor ännu"}
            description="Skapa en standardprislista med dina fasta priser. Den används i order, återkommande beställningar, kundportalen och kan användas i offerter."
            action={isAdmin ? <Button variant="brand" onClick={() => setNewOpen(true)}><Plus />Ny prislista</Button> : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((l) => (
              <Card key={l.id} interactive className="flex flex-col p-5">
                <Link to={`/app/prislistor/${l.id}`} className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold tracking-tight">{l.name}</h3>
                    {l.is_default && <Badge tone="brand"><Star className="size-3" />Standard</Badge>}
                    {l.customer_id && <Badge>Kund: {l.customers?.name}</Badge>}
                    {!l.active && <Badge tone="warning">Inaktiv</Badge>}
                  </div>
                  {l.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{l.description}</p>}
                  <p className="mt-3 font-mono text-xs text-muted-foreground">{l.price_list_items?.[0]?.count ?? 0} artiklar{(l.valid_from || l.valid_to) ? ` · ${l.valid_from ? formatDate(l.valid_from) : "–"} till ${l.valid_to ? formatDate(l.valid_to) : "tillsvidare"}` : ""}</p>
                </Link>
                {isAdmin && <div className="mt-4 flex justify-end border-t pt-3"><Button size="sm" variant="ghost" onClick={() => { setDup({ id: l.id, name: l.name }); setDupName(`${l.name} (kopia)`); setDupCustomer(""); }}><Copy />Duplicera</Button></div>}
              </Card>
            ))}
          </div>
        )}

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="Ny prislista" description="Den första gemensamma listan blir standard för alla kunder."
        footer={<><Button variant="ghost" onClick={() => setNewOpen(false)}>Avbryt</Button><Button variant="brand" type="submit" form="new-pl">Skapa</Button></>}>
        <form id="new-pl" onSubmit={create} className="grid gap-4 sm:grid-cols-2">
          <Field label="Namn *" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Packning 2026" autoFocus /></Field>
          <Field label="Beskrivning" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[72px]" /></Field>
          <Field label="Gäller kund" className="sm:col-span-2" hint="Lämna tomt för en gemensam lista.">
            <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="">Alla kunder (gemensam)</option>{customers.data?.filter((c) => !c.anonymized_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <Field label="Giltig från"><Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
          <Field label="Giltig till"><Input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></Field>
        </form>
      </Dialog>

      <Dialog open={!!dup} onOpenChange={(o) => !o && setDup(null)} title={`Duplicera ${dup?.name ?? ""}`} description="Artiklar och mängdrabatter kopieras. Originalet påverkas inte."
        footer={<><Button variant="ghost" onClick={() => setDup(null)}>Avbryt</Button><Button variant="brand" onClick={duplicate}><Copy />Duplicera</Button></>}>
        <div className="grid gap-4">
          <Field label="Namn på kopian"><Input value={dupName} onChange={(e) => setDupName(e.target.value)} /></Field>
          <Field label="Gör till kundspecifik lista för" hint="Valfritt – perfekt för att ge en kund egna avtalspriser.">
            <Select value={dupCustomer} onChange={(e) => setDupCustomer(e.target.value)}><option value="">Ingen (gemensam lista)</option>{customers.data?.filter((c) => !c.anonymized_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
