import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

interface AuthState { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void> }
const AuthContext = createContext<AuthState>({ session: null, user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") navigate("/aterstall-losenord");
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    try { localStorage.removeItem("op-org"); } catch { /* ignoreras */ }
    navigate("/logga-in");
  };

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
