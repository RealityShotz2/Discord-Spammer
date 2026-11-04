import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthLayout, PasswordHint, passwordValid } from "./AuthLayout";

export default function ResetPassword() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordValid(password)) return setError("Lösenordet uppfyller inte kraven.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    toast.success("Lösenordet är uppdaterat");
    navigate("/app");
  };

  if (!authLoading && !session) {
    return (
      <AuthLayout title="Länken är ogiltig" subtitle="Återställningslänken har gått ut eller redan använts." footer={<Link to="/glomt-losenord" className="font-medium text-brand hover:underline">Begär en ny länk</Link>}>
        <span />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Välj nytt lösenord">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nytt lösenord" hint={<PasswordHint />} htmlFor="pw"><Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" size="lg" className="w-full" loading={loading}>Spara lösenord</Button>
      </form>
    </AuthLayout>
  );
}
