// Central källa för abonnemangsplanernas visningsdata (priser, texter, funktionslistor).
// Gränser och behörigheter kontrolleras på servern via tabellen public.plans;
// src/plans.test.ts säkerställer att priser och gränser här stämmer med databasens migreringar.
// Priserna anges i SEK per månad, exklusive moms (25 % moms läggs på i kassan).

export type PlanId = "starter" | "professional" | "business";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceSek: number;
  description: string;
  features: string[];
  featured?: boolean;
  maxUsers: number;
  maxAiLeadsPerMonth: number;
}

export const VAT_RATE = 25;

export const PLANS: PlanDefinition[] = [
  {
    id: "starter",
    name: "Starter",
    priceSek: 399,
    description: "För enmansföretaget som vill komma igång.",
    features: ["1 användare", "30 AI-assisterade leads/mån", "AI-offertutkast", "PDF-export och kundlänk", "Grundläggande översikt"],
    maxUsers: 1,
    maxAiLeadsPerMonth: 30,
  },
  {
    id: "professional",
    name: "Professional",
    priceSek: 899,
    description: "För växande team med många förfrågningar.",
    features: ["Upp till 5 användare", "150 AI-assisterade leads/mån", "AI-skrivna uppföljningar", "Analys och diagram", "Egen profilfärg i offerter"],
    featured: true,
    maxUsers: 5,
    maxAiLeadsPerMonth: 150,
  },
  {
    id: "business",
    name: "Business",
    priceSek: 1799,
    description: "För företag med flera team och högre volym.",
    features: ["Upp till 25 användare", "600 AI-assisterade leads/mån", "Avancerade arbetsflöden", "Prioriterad support", "Fler integrationer"],
    maxUsers: 25,
    maxAiLeadsPerMonth: 600,
  },
];

export const planById = (id: string): PlanDefinition | undefined => PLANS.find((p) => p.id === id);

/** Pris som visas på sajten, t.ex. "1 799" (utan valutaenhet). */
export const formatPlanPrice = (priceSek: number): string => new Intl.NumberFormat("sv-SE").format(priceSek);

/** Pris inklusive moms, för information i kassan. */
export const priceInclVat = (priceSek: number): number => Math.round(priceSek * (1 + VAT_RATE / 100) * 100) / 100;
