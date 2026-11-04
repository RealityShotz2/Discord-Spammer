import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Membership, Organization, OrgSettings, Role, Usage } from "@/lib/types";
import { useAuth } from "./useAuth";

interface OrgState {
  loading: boolean;
  memberships: Membership[];
  org: Organization | null;
  role: Role | null;
  isAdmin: boolean;
  settings: OrgSettings | null;
  usage: Usage | null;
  switchOrg: (id: string) => void;
  refresh: () => Promise<void>;
}
const OrgContext = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem("op-org"); } catch { return null; }
  });

  const memberships = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Koppla väntande inbjudningar till kontot innan medlemskap läses
      await supabase.rpc("accept_pending_invitations");
      const { data, error } = await supabase.from("organization_members").select("organization_id,role,full_name,email,user_id,organizations(*)").eq("user_id", user!.id).order("created_at");
      if (error) throw error;
      return data as unknown as Membership[];
    },
  });

  const list = memberships.data ?? [];
  const current = list.find((m) => m.organization_id === activeId) ?? list[0] ?? null;
  const orgId = current?.organization_id;

  const settings = useQuery({
    queryKey: ["settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_settings").select("*").eq("organization_id", orgId!).single();
      if (error) throw error;
      return { ...data, default_vat_rate: Number(data.default_vat_rate), rot_percent: Number(data.rot_percent) } as OrgSettings;
    },
  });
  const usage = useQuery({
    queryKey: ["usage", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("usage_summary", { org: orgId });
      if (error) throw error;
      return data as Usage;
    },
  });

  useEffect(() => {
    if (orgId) try { localStorage.setItem("op-org", orgId); } catch { /* ignoreras */ }
  }, [orgId]);

  const value = useMemo<OrgState>(() => ({
    loading: memberships.isLoading || (!!orgId && settings.isLoading),
    memberships: list,
    org: current?.organizations ?? null,
    role: current?.role ?? null,
    isAdmin: current?.role === "admin",
    settings: settings.data ?? null,
    usage: usage.data ?? null,
    switchOrg: (id) => { setActiveId(id); qc.invalidateQueries(); },
    refresh: async () => { await qc.invalidateQueries({ queryKey: ["memberships"] }); await qc.invalidateQueries({ queryKey: ["settings"] }); await qc.invalidateQueries({ queryKey: ["usage"] }); },
  }), [memberships.isLoading, orgId, settings.isLoading, settings.data, usage.data, list, current, qc]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg måste användas inom OrgProvider");
  return ctx;
}

/** För sidor som kräver en organisation – returnerar id:t (garanterat av AppShell). */
export function useOrgId(): string {
  const { org } = useOrg();
  return org?.id ?? "";
}
