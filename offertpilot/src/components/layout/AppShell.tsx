import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing, BookOpen, Building2, Check, ChevronsUpDown, FileText, Inbox, LayoutDashboard, LogOut, Menu as MenuIcon, Moon,
  Settings as SettingsIcon, Sun, Users, X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/hooks/useOrg";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Logo } from "./Logo";

const NAV = [
  { to: "/app", label: "Översikt", icon: LayoutDashboard, end: true },
  { to: "/app/leads", label: "Leads", icon: Users },
  { to: "/app/offerter", label: "Offerter", icon: FileText },
  { to: "/app/uppfoljning", label: "Uppföljning", icon: BellRing, badge: "tasks" as const },
  { to: "/app/kommunikation", label: "Kommunikation", icon: Inbox },
  { to: "/app/kunskapsbas", label: "Kunskapsbas", icon: BookOpen },
  { to: "/app/installningar", label: "Inställningar", icon: SettingsIcon },
];

function UsageMeter() {
  const { usage } = useOrg();
  if (!usage) return null;
  const pct = Math.min(100, Math.round((usage.ai_leads_used / usage.max_ai_leads) * 100));
  const trialDays = usage.status === "trialing" && usage.trial_ends_at ? Math.max(0, Math.ceil((new Date(usage.trial_ends_at).getTime() - Date.now()) / 86400000)) : null;
  return (
    <Link to="/app/installningar/fakturering" className="block rounded-xl border bg-surface p-3 transition hover:border-brand/30">
      <div className="flex items-center justify-between">
        <span className="label-mono">{usage.plan_name}</span>
        {trialDays !== null && <span className="font-mono text-[10.5px] text-warning">{trialDays} dgr provperiod</span>}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">AI-leads denna månad</span>
        <span className="font-mono tabular">{usage.ai_leads_used}/{usage.max_ai_leads}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", pct > 85 ? "bg-warning" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { org, memberships, switchOrg } = useOrg();
  const { data: pending } = useQuery({
    queryKey: ["tasks-due-count", org?.id],
    enabled: !!org,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("follow_up_tasks").select("id", { count: "exact", head: true })
        .eq("organization_id", org!.id).eq("status", "pending").lte("due_at", new Date().toISOString());
      return count ?? 0;
    },
  });

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between px-1 pt-1">
        <Link to="/app" onClick={onNavigate}><Logo /></Link>
      </div>

      <Menu align="start" trigger={
        <button className="flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition hover:border-brand/30">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand to-violet-600 text-xs font-semibold text-white">{initials(org?.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{org?.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{org?.industry ?? "Företag"}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      }>
        <MenuLabel>Dina företag</MenuLabel>
        {memberships.map((m) => (
          <MenuItem key={m.organization_id} onSelect={() => switchOrg(m.organization_id)}>
            <Building2 />
            <span className="flex-1 truncate">{m.organizations.name}</span>
            {m.organization_id === org?.id && <Check className="!text-brand" />}
          </MenuItem>
        ))}
      </Menu>

      <nav className="flex flex-col gap-0.5" aria-label="Huvudmeny">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}
            className={({ isActive }) => cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground",
              isActive && "bg-accent text-foreground",
            )}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
                <n.icon className={cn("size-[18px] transition-colors", isActive ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} />
                <span className="flex-1">{n.label}</span>
                {n.badge === "tasks" && !!pending && <span className="rounded-full bg-brand px-1.5 py-px font-mono text-[10.5px] text-white">{pending}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <UsageMeter />
        <UserMenu />
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const { role } = useOrg();
  return (
    <Menu align="start" trigger={
      <button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-accent">
        <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">{initials(user?.email)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user?.email}</span>
          <span className="block text-xs text-muted-foreground">{role === "admin" ? "Administratör" : "Medarbetare"}</span>
        </span>
      </button>
    }>
      <MenuItem onSelect={toggle}>{dark ? <Sun /> : <Moon />}{dark ? "Ljust läge" : "Mörkt läge"}</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={signOut}><LogOut />Logga ut</MenuItem>
    </Menu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r bg-surface/60 backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>

      {/* Mobil */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-surface/80 px-4 backdrop-blur-xl lg:hidden">
        <Link to="/app"><Logo /></Link>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-accent" aria-label="Öppna meny"><MenuIcon className="size-5" /></button>
      </header>
      <div className={cn("fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => setOpen(false)} />
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-[280px] border-r bg-surface shadow-2xl transition-transform duration-500 ease-out lg:hidden", open ? "translate-x-0" : "-translate-x-full")} aria-hidden={!open}>
        <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 hover:bg-accent" aria-label="Stäng meny"><X className="size-4" /></button>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>

      <main className="lg:pl-[264px]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
