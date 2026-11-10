import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthLayout } from "./AuthLayout";

export default function Login() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const till = params.get("till") ?? "";
  const portal = till.startsWith("/portal");
  const next = /^\/(app|portal)(\/|$)/.test(till) ? till : "/app";

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    toast.success("Välkommen tillbaka!");
    navigate(next);
  };

  return (
    <AuthLayout title={portal ? "Logga in i kundportalen" : "Logga in"} subtitle={portal ? "Se dina priser, beställ och följ dina order." : "Fortsätt där du slutade."}
      footer={<>Inget konto ännu? <Link to={portal ? "/registrera?portal=1" : "/registrera"} className="font-medium text-brand hover:underline">Skapa konto</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {params.get("verifierad") && <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">E-postadressen är bekräftad. Logga in för att fortsätta.</p>}
        <Field label="E-postadress" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="namn@foretag.se" />
        </Field>
        <Field label={<span className="flex justify-between">Lösenord <Link to="/glomt-losenord" className="font-normal text-muted-foreground hover:text-foreground">Glömt lösenord?</Link></span>} htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" size="lg" className="w-full" loading={loading}>Logga in</Button>
      </form>
    </AuthLayout>
  );
}
