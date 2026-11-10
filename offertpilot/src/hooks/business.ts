// React Query-hooks för avtalskunder, prislistor, order och återkommande order (RLS i databasen).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Agreement, BusinessCustomer, Contact, Order, OrderItem, PortalUser, PriceList, PriceListItem, RecurringItem, RecurringOrder } from "@/lib/types";
import { normalizeCatalog, type CatalogItem } from "@shared/price-lists.ts";
import { useOrgId } from "./useOrg";

const num = <T,>(rows: T[], keys: (keyof T)[]): T[] => rows.map((r) => {
  const o = { ...r } as Record<keyof T, unknown>;
  for (const k of keys) if (o[k] !== null && o[k] !== undefined) o[k] = Number(o[k]);
  return o as T;
});
const ORDER_NUMS: (keyof Order)[] = ["subtotal", "discount_total", "vat_total", "total", "discount_percent", "payment_terms_days"];
export const normOrderItems = (rows: OrderItem[]) => num(rows, ["quantity", "unit_price", "discount_percent", "vat_rate", "line_total"]);

export function useCustomers() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["customers", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("organization_id", org).order("name").limit(2000);
      if (error) throw error;
      return num(data as BusinessCustomer[], ["discount_percent"]);
    },
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customer", id],
    enabled: !!id,
    queryFn: async () => {
      const [c, contacts, agreements, portal] = await Promise.all([
        supabase.from("customers").select("*").eq("id", id!).maybeSingle(),
        supabase.from("customer_contacts").select("*").eq("customer_id", id!).order("is_primary", { ascending: false }).order("name"),
        supabase.from("customer_agreements").select("*").eq("customer_id", id!).order("start_date", { ascending: false }),
        supabase.from("customer_portal_users").select("id,customer_id,email,contact_id,invited_at,accepted_at,disabled_at").eq("customer_id", id!).order("invited_at"),
      ]);
      if (c.error) throw c.error;
      if (!c.data) return null;
      return {
        customer: { ...(c.data as BusinessCustomer), discount_percent: Number(c.data.discount_percent) },
        contacts: (contacts.data ?? []) as Contact[],
        agreements: (agreements.data ?? []) as Agreement[],
        portalUsers: (portal.data ?? []) as PortalUser[],
      };
    },
  });
}

/** Kundens gällande prisbild (kundspecifik lista → avtalets lista → standardlista). */
export function useCatalog(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["catalog", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("customer_price_catalog", { cust: customerId });
      if (error) throw error;
      return normalizeCatalog(data ?? []);
    },
  });
}

export function usePriceLists() {
  const org = useOrgId();
  return useQuery({
    queryKey: ["price_lists", org],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_lists").select("*, customers(id,name), price_list_items(count)")
        .eq("organization_id", org).order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return data as (PriceList & { customers: { id: string; name: string } | null; price_list_items: { count: number }[] })[];
    },
  });
}

export function usePriceList(id: string | undefined) {
  return useQuery({
    queryKey: ["price_list", id],
    enabled: !!id,
    queryFn: async () => {
      const [l, items] = await Promise.all([
        supabase.from("price_lists").select("*, customers(id,name)").eq("id", id!).maybeSingle(),
        supabase.from("price_list_items").select("*, price_list_item_tiers(id,min_quantity,unit_price)").eq("price_list_id", id!).order("sort").order("name"),
      ]);
      if (l.error) throw l.error;
      if (!l.data) return null;
      return {
        list: l.data as PriceList & { customers: { id: string; name: string } | null },
        items: ((items.data ?? []) as PriceListItem[]).map((i) => ({
          ...i, unit_price: Number(i.unit_price), vat_rate: Number(i.vat_rate),
          price_list_item_tiers: (i.price_list_item_tiers ?? []).map((t) => ({ ...t, min_quantity: Number(t.min_quantity), unit_price: Number(t.unit_price) }))
            .sort((a, b) => a.min_quantity - b.min_quantity),
        })),
      };
    },
  });
}

export function useOrders(filter?: { customerId?: string }) {
  const org = useOrgId();
  return useQuery({
    queryKey: ["orders", org, filter?.customerId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("orders").select("*, customers(id,name,customer_number,email)").eq("organization_id", org).order("created_at", { ascending: false }).limit(1000);
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      const { data, error } = await q;
      if (error) throw error;
      return num(data as Order[], ORDER_NUMS);
    },
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["order", id],
    enabled: !!id,
    queryFn: async () => {
      const [o, items, history] = await Promise.all([
        supabase.from("orders").select("*, customers(id,name,customer_number,email)").eq("id", id!).maybeSingle(),
        supabase.from("order_items").select("*").eq("order_id", id!).order("sort").order("created_at"),
        supabase.from("order_status_history").select("*").eq("order_id", id!).order("created_at", { ascending: false }),
      ]);
      if (o.error) throw o.error;
      if (!o.data) return null;
      return {
        order: num([o.data as Order], ORDER_NUMS)[0],
        items: normOrderItems((items.data ?? []) as OrderItem[]),
        history: (history.data ?? []) as { id: number; from_status: string | null; to_status: string; note: string | null; created_at: string }[],
      };
    },
  });
}

export function useRecurringOrders(filter?: { customerId?: string }) {
  const org = useOrgId();
  return useQuery({
    queryKey: ["recurring", org, filter?.customerId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("recurring_orders").select("*, customers(id,name)").eq("organization_id", org).order("status").order("next_occurrence", { nullsFirst: false });
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      const { data, error } = await q;
      if (error) throw error;
      return data as RecurringOrder[];
    },
  });
}

export function useRecurringOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["recurring_order", id],
    enabled: !!id && id !== "ny",
    queryFn: async () => {
      const [r, items] = await Promise.all([
        supabase.from("recurring_orders").select("*, customers(id,name)").eq("id", id!).maybeSingle(),
        supabase.from("recurring_order_items").select("*").eq("recurring_order_id", id!).order("sort"),
      ]);
      if (r.error) throw r.error;
      return r.data ? { recurring: r.data as RecurringOrder, items: num((items.data ?? []) as RecurringItem[], ["quantity", "unit_price", "vat_rate"]) } : null;
    },
  });
}
