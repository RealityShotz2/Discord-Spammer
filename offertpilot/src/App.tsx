import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import { OrgProvider, useOrg } from "./hooks/useOrg";
import { supabaseConfigured } from "./lib/supabase";
import { AppShell } from "./components/layout/AppShell";
import Landing from "./pages/marketing/Landing";

const Legal = lazy(() => import("./pages/marketing/Legal"));
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const Onboarding = lazy(() => import("./pages/app/Onboarding"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const Leads = lazy(() => import("./pages/app/Leads"));
const LeadDetail = lazy(() => import("./pages/app/LeadDetail"));
const Quotations = lazy(() => import("./pages/app/Quotations"));
const QuotationEditor = lazy(() => import("./pages/app/QuotationEditor"));
const FollowUps = lazy(() => import("./pages/app/FollowUps"));
const Communication = lazy(() => import("./pages/app/Communication"));
const Knowledge = lazy(() => import("./pages/app/Knowledge"));
const Customers = lazy(() => import("./pages/app/Customers"));
const CustomerProfile = lazy(() => import("./pages/app/CustomerProfile"));
const PriceLists = lazy(() => import("./pages/app/PriceLists"));
const PriceListEditor = lazy(() => import("./pages/app/PriceListEditor"));
const Orders = lazy(() => import("./pages/app/Orders"));
const OrderEditor = lazy(() => import("./pages/app/OrderEditor"));
const RecurringOrderEditor = lazy(() => import("./pages/app/RecurringOrderEditor"));
const Settings = lazy(() => import("./pages/app/Settings"));
const Portal = lazy(() => import("./pages/portal/Portal"));
const PortalRegisterRedirect = lazy(() => import("./pages/portal/Portal").then((m) => ({ default: m.PortalRegisterRedirect })));
const InquiryForm = lazy(() => import("./pages/public/InquiryForm"));
const PublicQuote = lazy(() => import("./pages/public/PublicQuote"));
const NotFound = lazy(() => import("./pages/public/NotFound"));

export function FullPageLoader() {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Laddar">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (!supabaseConfigured) return <NotConfigured />;
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to={`/logga-in?till=${encodeURIComponent(loc.pathname)}`} replace />;
  return <OrgProvider>{children}</OrgProvider>;
}

function RequireOrg({ children }: { children: ReactNode }) {
  const { loading, org, settings } = useOrg();
  if (loading) return <FullPageLoader />;
  if (!org || (settings && !settings.onboarding_completed)) return <Navigate to="/kom-igang" replace />;
  return <AppShell>{children}</AppShell>;
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="label-mono mb-3">Konfiguration saknas</p>
      <h1 className="text-2xl font-semibold tracking-tight">Supabase är inte anslutet</h1>
      <p className="mt-3 text-sm text-muted-foreground">Ange <code className="font-mono">VITE_SUPABASE_URL</code> och <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> i <code className="font-mono">.env.local</code> och starta om. Se README för instruktioner.</p>
    </div>
  );
}

const app = (el: ReactNode) => <RequireAuth><RequireOrg>{el}</RequireOrg></RequireAuth>;

export function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/integritet" element={<Legal kind="privacy" />} />
        <Route path="/villkor" element={<Legal kind="terms" />} />
        <Route path="/logga-in" element={<Login />} />
        <Route path="/registrera" element={<Register />} />
        <Route path="/glomt-losenord" element={<ForgotPassword />} />
        <Route path="/aterstall-losenord" element={<ResetPassword />} />
        <Route path="/kom-igang" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/app" element={app(<Dashboard />)} />
        <Route path="/app/leads" element={app(<Leads />)} />
        <Route path="/app/leads/:id" element={app(<LeadDetail />)} />
        <Route path="/app/offerter" element={app(<Quotations />)} />
        <Route path="/app/offerter/:id" element={app(<QuotationEditor />)} />
        <Route path="/app/kunder" element={app(<Customers />)} />
        <Route path="/app/kunder/:id" element={app(<CustomerProfile />)} />
        <Route path="/app/prislistor" element={app(<PriceLists />)} />
        <Route path="/app/prislistor/:id" element={app(<PriceListEditor />)} />
        <Route path="/app/bestallningar" element={app(<Orders />)} />
        <Route path="/app/bestallningar/aterkommande/:id" element={app(<RecurringOrderEditor />)} />
        <Route path="/app/bestallningar/:id" element={app(<OrderEditor />)} />
        <Route path="/app/uppfoljning" element={app(<FollowUps />)} />
        <Route path="/app/kommunikation" element={app(<Communication />)} />
        <Route path="/app/kunskapsbas" element={app(<Knowledge />)} />
        <Route path="/app/installningar" element={app(<Settings />)} />
        <Route path="/app/installningar/:tab" element={app(<Settings />)} />
        <Route path="/portal" element={<Portal />} />
        <Route path="/portal/registrera" element={<PortalRegisterRedirect />} />
        <Route path="/portal/logga-in" element={<Navigate to="/logga-in?till=/portal" replace />} />
        <Route path="/forfragan/:key" element={<InquiryForm />} />
        <Route path="/offert/:token" element={<PublicQuote />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
