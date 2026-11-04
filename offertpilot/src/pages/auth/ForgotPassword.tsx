import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthLayout } from "./AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/aterstall-losenord` });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    setDone(true);
  };

  return (
    <AuthLayout title="Återställ lösenord" subtitle={done ? "Om adressen finns hos oss har vi skickat en återställningslänk. Den gäller i en timme." : "Ange din e-postadress så skickar vi en länk."}
      footer={<Link to="/logga-in" className="font-medium text-brand hover:underline">Tillbaka till inloggning</Link>}>
      {!done && (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-postadress" htmlFor="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="brand" size="lg" className="w-full" loading={loading}>Skicka länk</Button>
        </form>
      )}
    </AuthLayout>
  );
}
