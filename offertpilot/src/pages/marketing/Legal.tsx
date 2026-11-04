import { Link } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";

const PRIVACY = [
  ["Personuppgiftsansvar", "Företaget som använder OffertPilot AI är personuppgiftsansvarigt för sina kunders uppgifter. OffertPilot AI är personuppgiftsbiträde och behandlar uppgifterna enligt ett personuppgiftsbiträdesavtal (PUB-avtal). Tjänsten tillhandahålls av OffertPilot, Målaregatan 1, 693 33 Degerfors. [Organisationsnummer och e-post för dataskyddsfrågor fylls i före lansering.]"],
  ["Vilka uppgifter vi behandlar", "Kontoinformation (namn, e-post), företagsuppgifter samt uppgifter om ert företags kunder: namn, kontaktuppgifter, förfrågningar, meddelanden och offerter."],
  ["Ändamål och rättslig grund", "Uppgifterna behandlas för att tillhandahålla tjänsten (avtal), för säkerhet och missbruksskydd (berättigat intresse) samt för att uppfylla bokföringskrav (rättslig förpliktelse)."],
  ["AI-behandling", "Text från förfrågningar skickas till vald AI-leverantör för analys och utkast. Data används inte för att träna modeller. [Ange leverantör, region och underbiträden.]"],
  ["Lagring och radering", "Data lagras inom EU/EES. [Ange region.] Kunddata kan exporteras och raderas i tjänsten. Offertbelopp kan sparas anonymiserat så länge bokföringslagen kräver det."],
  ["Dina rättigheter", "Du har rätt till tillgång, rättelse, radering, begränsning, dataportabilitet och att invända. Du kan klaga hos Integritetsskyddsmyndigheten (IMY)."],
  ["Kontakt", "[E-postadress till dataskyddsansvarig]"],
];
const TERMS = [
  ["Tjänsten", "OffertPilot AI är ett verktyg som hjälper företag att hantera förfrågningar, ta fram offertutkast och följa upp affärer. Avtalspart är OffertPilot, Målaregatan 1, 693 33 Degerfors."],
  ["Ansvar för innehåll", "Kunden ansvarar för priser, villkor och innehåll i offerter. Alla offerter och utgående meddelanden granskas och godkänns av kunden innan de skickas. AI-genererade utkast kan innehålla fel."],
  ["Abonnemang och betalning", "Abonnemang debiteras månadsvis i förskott. Priser anges exklusive moms. [Ange uppsägningstid och villkor för ändringar.]"],
  ["Tillgänglighet", "Vi strävar efter hög tillgänglighet men garanterar inte avbrottsfri drift. [Ange eventuell SLA.]"],
  ["Uppsägning", "Kunden kan säga upp abonnemanget när som helst och exportera sin data. [Ange tid för radering efter uppsägning.]"],
  ["Tillämplig lag", "Svensk lag gäller. Tvist avgörs av allmän domstol."],
];

export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const sections = kind === "privacy" ? PRIVACY : TERMS;
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6"><Link to="/"><Logo /></Link><Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Till startsidan</Link></header>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="label-mono">Utkast – ska granskas juridiskt</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{kind === "privacy" ? "Integritetspolicy" : "Användarvillkor"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Senast uppdaterad: [datum]. Text inom hakparentes är platshållare som måste fyllas i innan lansering.</p>
        <div className="mt-12 space-y-10">
          {sections.map(([h, p]) => <section key={h}><h2 className="text-lg font-semibold tracking-tight">{h}</h2><p className="mt-2 leading-relaxed text-muted-foreground">{p}</p></section>)}
        </div>
      </main>
    </div>
  );
}
