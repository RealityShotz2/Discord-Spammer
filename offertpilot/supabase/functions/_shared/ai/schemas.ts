// Strukturerade AI-svar. Varje svar valideras mot dessa scheman innan det sparas.
// Observera: inga scheman innehåller priser – priser hämtas alltid från företagets katalog.
import { z } from "zod";

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const LeadAnalysisSchema = z.object({
  summary: shortText(600).describe("Kort sammanfattning på svenska av vad kunden vill ha hjälp med."),
  category: shortText(80).describe("Typ av uppdrag, t.ex. 'Badrumsrenovering'."),
  priority: z.enum(["low", "medium", "high"]).describe("Prioritet baserat på tydlighet, omfattning och brådska."),
  matched_service_ids: z.array(z.string().uuid()).max(10)
    .describe("ID för tjänster i företagets katalog som matchar förfrågan. Tom lista om inga matchar."),
  missing_information: z.array(shortText(200)).max(8)
    .describe("Information som saknas för att kunna lämna en offert."),
  qualification_questions: z.array(shortText(300)).max(6)
    .describe("Följdfrågor att ställa till kunden, formulerade på svenska."),
  next_action: shortText(300).describe("Rekommenderad nästa säljaktivitet."),
  is_spam: z.boolean().describe("Sant om meddelandet är skräppost eller inte en riktig förfrågan."),
});
export type LeadAnalysis = z.infer<typeof LeadAnalysisSchema>;

export const QuoteDraftSchema = z.object({
  title: shortText(160),
  project_description: shortText(2000).describe("Beskrivning av arbetet som offereras, på svenska."),
  items: z.array(z.object({
    service_id: z.string().uuid().nullable()
      .describe("ID för en tjänst i katalogen, eller null om ingen tjänst passar (då krävs manuellt pris)."),
    description: shortText(300),
    quantity: z.number().positive().max(100000)
      .describe("Mängd, endast om den framgår av kundens uppgifter. Annars 1 och en antagande-notering."),
    unit: shortText(12),
    reason: shortText(300).describe("Varför raden ingår och hur mängden bestämdes."),
  })).min(1).max(30),
  applicable_pricing_rule_ids: z.array(z.string().uuid()).max(10)
    .describe("Prisregler från företagets lista vars villkor uppfylls. Hitta aldrig på nya regler."),
  assumptions: z.array(shortText(300)).max(10),
  missing_information: z.array(shortText(300)).max(10),
});
export type QuoteDraft = z.infer<typeof QuoteDraftSchema>;

export const MessageDraftSchema = z.object({
  subject: shortText(160),
  body: shortText(4000).describe("Meddelandet på svenska, utan signatur-platshållare som [Namn]."),
});
export type MessageDraft = z.infer<typeof MessageDraftSchema>;

export const schemas = {
  lead_analysis: LeadAnalysisSchema,
  quote_draft: QuoteDraftSchema,
  message_draft: MessageDraftSchema,
} as const;
export type SchemaName = keyof typeof schemas;
