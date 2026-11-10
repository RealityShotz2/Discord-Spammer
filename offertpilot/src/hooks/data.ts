// React Query-hooks för affärsdata. All åtkomst filtreras av RLS i databasen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { callFunction, errorMessage } from "@/lib/api";
import type { FollowUpTask, KnowledgeItem, Lead, Message, PricingRule, Quotation, QuotationItem, Service } from "@/lib/types";
import { useOrgId } from "./useOrg";

const num = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T => {
  const r = { ...row };
  for (const k of keys) if (r[k] !== null && r[k] !== undefined) (r as Record<keyof T, unknown>)[k] = Number(r[k]);
  return r;
};
const QUOTE_NUMS = ["discount_value", "rot_percent", "subtotal", "discount_total", "vat_total", "total", "rot_deduction", "total_to_pay"] as const;
export const normQuote = (q: Quotation) => num(q as never, QUOTE_NUMS as never) as Quotation;
export const normItem = (i: QuotationItem) => num(i as never, ["quantity", "unit_price", "discount_percent", "vat_rate", "line_total"] as never) as QuotationItem;

export function useLeads() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["leads", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*, customers(id,name,email,phone,company_name,city,opted_out)")
        .eq("organization_id", org).order("position", { ascending: true }).limit(1000);
      if (error) throw error;
      return (data as Lead[]).map((l) => ({ ...l, estimated_value: l.estimated_value === null ? null : Number(l.estimated_value) }));
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ["lead", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*, customers(*)").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as (Lead & { customers: import("@/lib/types").Customer }) | null;
    },
  });
}

export function useLeadMessages(leadId: string | undefined) {
  return useQuery({
    queryKey: ["messages", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*").eq("lead_id", leadId!).order("created_at");
      if (error) throw error;
      return data as Message[];
    },
  });
}

export function useQuotations(filter?: { leadId?: string }) {
  const org = useOrgId();
  return useQuery({
    queryKey: ["quotations", org, filter?.leadId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("quotations").select("*, customers(id,name,email,company_name)").eq("organization_id", org).order("created_at", { ascending: false }).limit(500);
      if (filter?.leadId) q = q.eq("lead_id", filter.leadId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as Quotation[]).map(normQuote);
    },
  });
}

export function useServices() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["services", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("organization_id", org).order("sort").order("name");
      if (error) throw error;
      return (data as Service[]).map((s) => ({ ...s, unit_price: s.unit_price === null ? null : Number(s.unit_price), vat_rate: Number(s.vat_rate) }));
    },
  });
}

export function usePricingRules() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["pricing_rules", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("pricing_rules").select("*").eq("organization_id", org).order("created_at");
      if (error) throw error;
      return (data as PricingRule[]).map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }));
    },
  });
}

export function useKnowledge() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["knowledge", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_items").select("*").eq("organization_id", org).order("created_at");
      if (error) throw error;
      return data as KnowledgeItem[];
    },
  });
}

export function useTasks(filter?: { leadId?: string; status?: "pending" | "closed" }) {
  const org = useOrgId();
  return useQuery({
    queryKey: ["tasks", org, filter?.leadId ?? "all", filter?.status ?? "all"],
    queryFn: async () => {
      let q = supabase.from("follow_up_tasks").select("*, leads(id,title,stage,customers(name,email,opted_out)), quotations(number,total), customers(id,name,email,opted_out), orders(id,number)")
        .eq("organization_id", org).order("due_at").limit(500);
      if (filter?.leadId) q = q.eq("lead_id", filter.leadId);
      if (filter?.status === "pending") q = q.eq("status", "pending");
      if (filter?.status === "closed") q = q.neq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as FollowUpTask[];
    },
  });
}

/** Kör en AI-uppgift och invaliderar berörda frågor. */
export function useAiTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => callFunction<{ demo?: boolean; quotation_id?: string; message_id?: string; draft?: { subject: string; body: string }; warnings?: string[] }>("ai", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (res.demo) toast.info("Demoläge: ingen AI-nyckel är konfigurerad, resultatet kommer från en regelmotor.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
