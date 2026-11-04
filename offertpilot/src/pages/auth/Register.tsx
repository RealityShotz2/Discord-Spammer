import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthLayout, PasswordHint, passwordValid } from "./AuthLayout";

export default function Register() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const invited = params.get("inbjudan") === "1";

  if (user) return <Navigate to="/app" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Ange en giltig e-postadress.");
    if (!passwordValid(password)) return setError("Lösenordet måste vara minst 10 tecken och innehålla stora och små bokstäver samt siffror.");
    if (!accept) return setError("Du behöver godkänna villkoren och integritetspolicyn.");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/logga-in?verifierad=1` },
    });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout title="Bekräfta din e-post" subtitle={<>Vi har skickat en länk till <strong className="text-foreground">{email}</strong>. Klicka på den för att aktivera ditt konto.</>}
        footer={<>Fick du inget mejl? Kolla skräpposten eller <button className="font-medium text-brand hover:underline" onClick={() => supabase.auth.resend({ type: "signup", email })}>skicka igen</button>.</>}>
        <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand"><MailCheck className="size-6" /></div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={invited ? "Gå med i ditt team" : "Skapa ditt konto"}
      subtitle={invited ? "Skapa ett konto med e-postadressen du blev inbjuden med." : "14 dagars provperiod. Inget kort krävs."}
      footer={<>Har du redan ett konto? <Link to="/logga-in" className="font-medium text-brand hover:underline">Logga in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Jobbmejl" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="namn@foretag.se" />
        </Field>
        <Field label="Lösenord" hint={<PasswordHint />} htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 rounded accent-[hsl(var(--brand))]" />
          <span>Jag godkänner <Link to="/villkor" className="text-foreground underline-offset-2 hover:underline">användarvillkoren</Link> och har läst <Link to="/integritet" className="text-foreground underline-offset-2 hover:underline">integritetspolicyn</Link>.</span>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" size="lg" className="w-full" loading={loading}>Skapa konto</Button>
      </form>
    </AuthLayout>
  );
}
