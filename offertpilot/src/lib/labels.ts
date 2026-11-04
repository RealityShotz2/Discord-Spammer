import type { LeadSource, LeadStage, QuoteStatus } from "./types";

export const STAGES: { id: LeadStage; label: string; hint: string }[] = [
  { id: "new", label: "Ny lead", hint: "Inkomna förfrågningar" },
  { id: "qualification", label: "AI-kvalificering", hint: "Analyserade, behöver mer info" },
  { id: "quote_draft", label: "Offertutkast", hint: "Offert under arbete" },
  { id: "quote_sent", label: "Offert skickad", hint: "Väntar på kundens svar" },
  { id: "negotiation", label: "Förhandling", hint: "Dialog om villkor" },
  { id: "won", label: "Vunnen", hint: "Affär klar" },
  { id: "lost", label: "Förlorad", hint: "Ingen affär" },
];
export const stageLabel = (s: LeadStage) => STAGES.find((x) => x.id === s)?.label ?? s;

export const SOURCES: Record<LeadSource, string> = { website: "Webbformulär", manual: "Manuell", email: "E-post", phone: "Telefon", other: "Övrigt" };

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: "neutral" | "brand" | "warning" | "success" | "danger" }> = {
  draft: { label: "Utkast", tone: "neutral" },
  pending_approval: { label: "Väntar på godkännande", tone: "warning" },
  approved: { label: "Godkänd", tone: "brand" },
  sent: { label: "Skickad", tone: "brand" },
  accepted: { label: "Accepterad", tone: "success" },
  declined: { label: "Avböjd", tone: "danger" },
  expired: { label: "Utgången", tone: "neutral" },
};

export const PRIORITY: Record<string, { label: string; tone: "neutral" | "warning" | "danger" }> = {
  low: { label: "Låg", tone: "neutral" },
  medium: { label: "Medel", tone: "warning" },
  high: { label: "Hög", tone: "danger" },
};

export const ACTIVITY: Record<string, string> = {
  "organization.created": "Företaget skapades",
  "lead.created": "Ny lead",
  "lead.stage_changed": "Lead flyttad",
  "quotation.submitted": "Offert skickad för godkännande",
  "quotation.approved": "Offert godkänd",
  "quotation.reopened": "Offert öppnad för ändring",
  "quotation.sent": "Offert skickad",
  "quotation.accepted": "Offert accepterad",
  "quotation.declined": "Offert avböjd",
  "ai.analyze_lead": "AI analyserade lead",
  "ai.draft_quotation": "AI skapade offertutkast",
  "ai.reply_draft": "AI skrev svarsutkast",
  "ai.followup_message": "AI skrev uppföljning",
  "message.sent": "Meddelande skickat",
  "message.demo_not_sent": "Meddelande sparat (demoläge)",
  "member.invited": "Kollega inbjuden",
  "member.joined": "Kollega anslöt",
  "member.removed": "Medlem borttagen",
  "member.role_changed": "Roll ändrad",
  "customer.opted_out": "Kund avböjde utskick",
  "customer.anonymized": "Kunddata anonymiserad",
};

export const UNITS = ["st", "tim", "m²", "m", "lpm", "dag", "paket", "km"];
export const INDUSTRIES = ["Bygg & renovering", "El & installation", "VVS", "Måleri", "Städ & fastighetsservice", "Trädgård & mark", "Flytt & transport", "IT & konsult", "Event & catering", "Annat"];
