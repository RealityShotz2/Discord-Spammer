import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-brand">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sidan finns inte</h1>
        <p className="mt-2 text-sm text-muted-foreground">Kontrollera adressen eller gå tillbaka till startsidan.</p>
        <Button className="mt-6" variant="brand" asChild><Link to="/">Till startsidan</Link></Button>
      </div>
    </div>
  );
}
