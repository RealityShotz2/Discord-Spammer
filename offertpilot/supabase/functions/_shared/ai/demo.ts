// Demoläge: deterministisk regelmotor som används när ingen AI-nyckel är konfigurerad.
// Resultaten märks alltid som "demo" i gränssnittet. Den följer samma säkerhetsregler:
// inga priser, bara tjänster från katalogen.
import type { LeadAnalysis, MessageDraft, QuoteDraft } from "./schemas.ts";
import type { LeadContext, OrgContext, ServiceCtx } from "./context.ts";

const STOP = new Set(["och", "att", "det", "som", "för", "med", "till", "på", "av", "en", "ett", "är", "vi", "ni", "jag", "har", "kan", "vill", "om", "i"]);

function tokens(text: string): string[] {
  return text.toLowerCase().normalize("NFC").split(/[^a-zåäöé0-9²]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

function stem(t: string): string {
  return t.slice(0, Math.min(t.length, 6));
}

export function matchServices(text: string, services: ServiceCtx[]): ServiceCtx[] {
  const words = new Set(tokens(text).map(stem));
  const scored = services.map((s) => {
    const sw = tokens(`${s.name} ${s.description ?? ""}`).map(stem);
    const nameHits = tokens(s.name).map(stem).filter((w) => words.has(w)).length;
    const hits = sw.filter((w) => words.has(w)).length;
    return { s, score: nameHits * 3 + hits };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((x) => x.s);
}

export function extractArea(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(?:kvm|m2|m²|kvadrat)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function extractHours(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(?:timmar|tim|h\b)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function firstSentences(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return sentences.length > max ? sentences.slice(0, max - 1) + "…" : sentences;
}

export function demoAnalyzeLead(org: OrgContext, lc: LeadContext): LeadAnalysis {
  const text = [lc.lead.requested_service, lc.lead.message, ...lc.messages.filter((m) => m.direction === "inbound").map((m) => m.body)]
    .filter(Boolean).join(" ");
  const lower = text.toLowerCase();
  const matched = matchServices(text, org.services);
  const missing: string[] = [];
  const questions: string[] = [];

  if (extractArea(text) === null && /badrum|golv|kök|målning|tak|fasad|kakel|platt|yta|rum/.test(lower)) {
    missing.push("Ytans storlek (m²)");
    questions.push("Hur stor är ytan som ska åtgärdas, ungefär i kvadratmeter?");
  }
  if (!/\d{3}\s?\d{2}|gatan|vägen|gränd|plan|ort|stad/.test(lower) && !lc.customer.city) {
    missing.push("Adress eller ort för uppdraget");
    questions.push("Var ska arbetet utföras (adress eller ort)?");
  }
  if (!/vecka|månad|datum|snart|snarast|asap|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|vår|sommar|höst|vinter/.test(lower)) {
    missing.push("Önskad tidpunkt för start");
    questions.push("När skulle ni vilja att arbetet påbörjas?");
  }
  if (!/budget|kr\b|kronor|sek/.test(lower)) {
    missing.push("Budget eller prisram");
    questions.push("Har ni en ungefärlig budget för projektet?");
  }
  if (/badrum|kök|renover/.test(lower) && !/bild|foto/.test(lower)) {
    questions.push("Kan ni skicka några bilder på nuvarande utrymme?");
  }

  const urgent = /akut|snarast|läck|vattenskada|omgående|brådskande/.test(lower);
  const spam = (text.match(/https?:\/\//g)?.length ?? 0) > 2 || /casino|viagra|crypto|bitcoin|seo-tjänster|backlinks/.test(lower);
  const category = matched[0]?.name ?? lc.lead.requested_service ?? "Allmän förfrågan";

  return {
    summary: firstSentences(lc.lead.message || lc.lead.title) || "Kunden har skickat en förfrågan utan beskrivning.",
    category: category.slice(0, 80),
    priority: spam ? "low" : urgent ? "high" : text.length < 60 ? "low" : "medium",
    matched_service_ids: matched.map((s) => s.id),
    missing_information: missing.slice(0, 8),
    qualification_questions: questions.slice(0, 6),
    next_action: spam
      ? "Granska förfrågan – den ser ut som skräppost."
      : missing.length > 1
        ? "Skicka följdfrågor till kunden för att kunna ta fram en korrekt offert."
        : matched.length
          ? "Skapa ett offertutkast baserat på matchade tjänster."
          : "Kontakta kunden per telefon för att förstå behovet.",
    is_spam: spam,
  };
}

export function demoQuoteDraft(org: OrgContext, lc: LeadContext, preferredServiceIds: string[]): QuoteDraft {
  const text = [lc.lead.requested_service, lc.lead.message].filter(Boolean).join(" ");
  const byId = new Map(org.services.map((s) => [s.id, s]));
  let chosen = preferredServiceIds.map((id) => byId.get(id)).filter((s): s is ServiceCtx => !!s);
  if (chosen.length === 0) chosen = matchServices(text, org.services);
  const area = extractArea(text);
  const hours = extractHours(text);
  const assumptions: string[] = [];

  const items: QuoteDraft["items"] = chosen.map((s) => {
    const unit = s.unit.toLowerCase();
    let quantity = 1;
    let reason = "Matchar kundens förfrågan.";
    if ((unit.includes("m²") || unit.includes("kvm") || unit === "m2") && area) {
      quantity = area;
      reason = `Kunden anger ${area} m².`;
    } else if (unit.startsWith("tim") && hours) {
      quantity = hours;
      reason = `Kunden anger ${hours} timmar.`;
    } else if (unit !== "st" && unit !== "paket") {
      assumptions.push(`Mängd för "${s.name}" är satt till 1 ${s.unit} och behöver justeras.`);
      reason = "Mängd framgår inte av förfrågan.";
    }
    return { service_id: s.id, description: s.name, quantity, unit: s.unit, reason };
  });

  if (items.length === 0) {
    items.push({
      service_id: null,
      description: lc.lead.requested_service || "Arbete enligt förfrågan",
      quantity: 1,
      unit: "st",
      reason: "Ingen tjänst i katalogen matchar – pris måste sättas manuellt.",
    });
  }

  return {
    title: (lc.lead.requested_service || chosen[0]?.name || "Offert").slice(0, 160),
    project_description: [
      `Offerten avser ${(lc.lead.requested_service || chosen[0]?.name || "arbete").toLowerCase()} enligt förfrågan från ${lc.customer.name}.`,
      chosen.length ? `Arbetet omfattar: ${chosen.map((s) => s.name.toLowerCase()).join(", ")}.` : "",
      `Kundens beskrivning: ”${firstSentences(lc.lead.message || lc.lead.title, 300)}”`,
    ].filter(Boolean).join(" ").slice(0, 2000),
    items,
    applicable_pricing_rule_ids: org.pricingRules.filter((r) => r.kind === "fixed_fee" && /alla|samtliga|varje/.test((r.condition ?? "").toLowerCase())).map((r) => r.id),
    assumptions,
    missing_information: lc.lead.ai_missing_info ?? [],
  };
}

export function demoReply(org: OrgContext, lc: LeadContext, questions: string[]): MessageDraft {
  const first = lc.customer.name.split(" ")[0];
  const qs = questions.length ? questions : ["Kan du berätta lite mer om vad du behöver hjälp med?"];
  return {
    subject: `Angående din förfrågan${lc.lead.requested_service ? `: ${lc.lead.requested_service}` : ""}`.slice(0, 160),
    body: `Hej ${first}!\n\nTack för din förfrågan till ${org.org.name}. För att kunna ta fram en korrekt offert behöver vi veta lite mer:\n\n${qs.map((q) => `• ${q}`).join("\n")}\n\nSvara gärna direkt på det här mejlet så återkommer vi så snart vi kan.\n\nVänliga hälsningar\n${org.org.name}`,
  };
}

export function demoFollowUp(org: OrgContext, lc: LeadContext, quoteNumber: string | null, sequence: number): MessageDraft {
  const first = lc.customer.name.split(" ")[0];
  const ref = quoteNumber ? `offerten ${quoteNumber}` : "din förfrågan";
  const body = sequence <= 1
    ? `Hej ${first}!\n\nJag ville bara höra hur du tycker att ${ref} ser ut. Har du några frågor eller funderingar är du välkommen att höra av dig, så går vi igenom den tillsammans.`
    : `Hej ${first}!\n\nVi har inte hört något från dig angående ${ref} och ville kolla om det fortfarande är aktuellt. Om något behöver justeras hjälper vi gärna till.`;
  return { subject: `Uppföljning av ${ref}`, body: `${body}\n\nVänliga hälsningar\n${org.org.name}` };
}
