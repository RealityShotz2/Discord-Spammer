# Offertfabriken

AI-driven säljassistent för svenska små och medelstora företag: tar emot förfrågningar, analyserar dem, tar fram offertutkast med företagets **egna** priser, låter ägaren godkänna och följer upp affären.

**Första kompletta användarresan (verifierad end-to-end):**
Registrera → bekräfta e-post → konfigurera företag → lägg in tjänster och priser → förfrågan via webbformulär → AI analyserar → AI-offertutkast → ägaren godkänner → PDF/utskick → kunden accepterar via länk → uppföljning.

---

## Arkitektur

```
┌──────────────────────────┐      ┌─────────────────────────────────────────────┐
│ React + TS + Tailwind    │      │ Supabase                                    │
│ (Vite, React Query)      │─────▶│  Auth (e-post/lösenord, bekräftelse, reset) │
│  • Marknadssida          │ RLS  │  PostgreSQL + Row Level Security            │
│  • App (/app/…)          │      │   – affärslogik i SQL (summering, status,   │
│  • Publikt formulär      │      │     godkännande, numrering, kvoter, GDPR)   │
│  • Publik offertvy       │      │  Edge Functions (Deno)                      │
└──────────────────────────┘      │   ai · send-quotation · send-message        │
                                  │   public-inquiry · public-quote             │
                                  │   team-invite · billing · stripe-webhook    │
                                  └──────────┬───────────────┬──────────────────┘
                                             │               │
                                    Anthropic/OpenAI      Resend · Stripe
```

| Lager | Var | Ansvar |
|---|---|---|
| UI | `src/` | Sidor, komponenter, React Query-hooks. Inga hemligheter. |
| Delad logik | `supabase/functions/_shared/` | Prisberäkning, PDF, AI-scheman, offertmontering – används av både klient och server (`@shared/*`). |
| AI-tjänster | `_shared/ai/` | `provider.ts` (Anthropic/OpenAI/demo, timeout, schemavalidering + ett omförsök), `context.ts` (prompt + inkapsling av kunddata), `services.ts` (6 tjänster), `quote-assembly.ts` (priser från katalogen), `demo.ts` (regelmotor utan nyckel). |
| Databas | `supabase/migrations/` | Schema, RLS, kolumnrättigheter, RPC:er och triggers. |
| Tester | `supabase/tests/`, `src/shared.test.ts`, `scripts/` | pgTAP, Vitest, API-E2E, webbläsar-E2E. |

### Viktiga säkerhetsbeslut

- **Isolering per organisation:** varje tabell har `organization_id` + RLS. Barntabeller har *sammansatta* främmande nycklar `(id, organization_id)` så att en rad aldrig kan kopplas till en förälder i ett annat företag, även om id:t är känt.
- **`anon` har ingen tabellåtkomst.** Publika flöden (formulär, kundens offertlänk, Stripe) går via edge functions med validering och rate limiting.
- **Kolumnrättigheter:** klienten kan inte sätta offertstatus, summor, nummer, token, `approved_by` eller AI-flaggor. Det görs bara av `SECURITY DEFINER`-funktioner som kontrollerar roll.
- **Summor räknas i databasen** (trigger) – klientens förhandsvisning använder samma algoritm (`pricing.ts`) och testas mot samma värden.
- **AI sätter aldrig priser:** AI-schemat innehåller inga prisfält. `assembleQuote` hämtar pris, moms och ROT-flagga från katalogen; okända tjänster får `unit_price = NULL`. `approve_quotation` vägrar så länge något pris saknas. Rabatt- och tilläggsregler föreslås bara, de läggs aldrig till automatiskt.
- **Mänskligt godkännande:** offerter kräver admin-godkännande; varje utgående meddelande kräver ett klick. Låsta offerter (efter inskick) kan inte ändras utan `reopen_quotation`, som skapar en ny version.
- **Prompt injection:** kunddata kapslas in i `<kunddata>`, taggar som kan bryta inkapslingen tas bort, längder begränsas, systemprompten förbjuder att följa instruktioner i kunddata och svaret valideras mot schema. Även om modellen "lyder" kan den inte påverka priser eller skicka något.
- **Planspärrar på servern:** `check_ai_quota` (AI-leads/månad, funktionsflaggor, provperiod) och `invite_member` (antal platser) körs i databasen.
- **Demoläge, inget fusk:** utan AI-nyckel används en regelmotor som tydligt märks "Demoläge". Utan Resend skickas **ingenting** och användaren får veta det (offerten kan då laddas ner och markeras som skickad manuellt). Utan Stripe sker ingen debitering.

### Datamodell

`plans · organizations · organization_members · organization_invitations · organization_settings · subscriptions · usage_records · services · pricing_rules · knowledge_items · message_templates · customers · leads · conversations · messages · quotations · quotation_items · quotation_versions · follow_up_tasks · activity_logs · rate_limits`

Leadstatus: `new → qualification → quote_draft → quote_sent → negotiation → won/lost`.
Offertstatus: `draft → pending_approval → approved → sent → accepted/declined/expired`.

---

## Kom igång lokalt

Krav: Node 20+, Docker.

```bash
npm install
npx supabase start                       # Postgres, Auth, Mailpit, Kong
npx supabase functions serve             # edge functions (ny terminal)
cp .env.example .env.local               # fyll i ANON_KEY från `npx supabase status`
npm run dev                              # http://localhost:5173
```

Bekräftelsemejl och lösenordsåterställning hamnar lokalt i Mailpit: http://127.0.0.1:54324.

### Tester

```bash
npm run typecheck            # TypeScript
npm test                     # Vitest: prisberäkning, offertmontering, prompt injection, demoläge
npx supabase test db         # pgTAP: 47 tester för RLS, roller, låsning, godkännande, uppföljning
node scripts/e2e-api.mjs     # 29 API-kontroller mot lokala edge functions
node scripts/e2e-ui.mjs      # 15 steg i webbläsaren (Playwright) – hela användarresan
```

---

## Miljövariabler

**Frontend** (`.env.local`, publika):

| Variabel | Beskrivning |
|---|---|
| `VITE_SUPABASE_URL` | Supabase-projektets URL |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable-nyckel |

**Edge functions** (`npx supabase secrets set …`, hemliga):

| Variabel | Krävs | Beskrivning |
|---|---|---|
| `APP_URL` | ja | Publik URL till appen (länkar i e-post), t.ex. `https://app.offertfabriken.se` |
| `ALLOWED_ORIGINS` | rek. | Kommaseparerade origins för CORS (standard `*`) |
| `RATE_LIMIT_SALT` | rek. | Salt för hashning av IP-adresser |
| `ANTHROPIC_API_KEY` | ett av | Claude (standardmodell `claude-opus-5-5`) |
| `OPENAI_API_KEY` | ett av | OpenAI eller kompatibel (`OPENAI_BASE_URL`) |
| `AI_PROVIDER` | nej | `anthropic` eller `openai` om båda nycklarna finns |
| `AI_MODEL` | nej | Åsidosätt modell |
| `AI_TIMEOUT_MS` | nej | Standard 90000 |
| `AI_EFFORT` | nej | `low`, `medium` (standard) eller `high` – lägre ger snabbare och billigare svar |
| `RESEND_API_KEY`, `EMAIL_FROM` | för e-post | Utan dessa: demoläge, inget skickas |
| `STRIPE_SECRET_KEY` | för betalning | Utan: demoläge, ingen debitering |
| `STRIPE_WEBHOOK_SECRET` | för betalning | Signaturverifiering av webhooks |
| `STRIPE_PRICE_STARTER/PROFESSIONAL/BUSINESS` | för betalning | Pris-ID:n (alternativt `plans.stripe_price_id`) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` och `SUPABASE_SERVICE_ROLE_KEY` sätts automatiskt av Supabase.

---

## Driftsättning

1. **Supabase:** skapa projekt (EU-region), `npx supabase link --project-ref <ref>`, `npx supabase db push`.
2. **Auth:** Site URL = `APP_URL`, redirect-URL `APP_URL/**`, aktivera e-postbekräftelse, koppla egen SMTP och klistra in mallarna från `supabase/templates/`.
3. **Edge functions:** `npx supabase functions deploy` och sätt hemligheterna ovan. `public-inquiry`, `public-quote` och `stripe-webhook` har `verify_jwt = false` (se `config.toml`).
4. **Frontend:** bygg med `npm run build` och lägg upp `dist/` på Vercel/Netlify/Lovable med SPA-fallback till `index.html`.
5. **Stripe:** skapa tre återkommande priser, sätt webhook till `…/functions/v1/stripe-webhook` (`checkout.session.completed`, `customer.subscription.*`). Testa i testläge innan livenycklar används.
6. **Resend:** verifiera avsändardomänen (SPF/DKIM) innan `EMAIL_FROM` sätts.

Planpriser och gränser ändras i tabellen `plans`, inte i koden.

---

## Kända begränsningar

- **Inkommande e-post** importeras inte automatiskt. Kundens svar loggas manuellt i konversationen. Arkitekturen (kanal `email`) är förberedd.
- **Automatiska utskick** finns inte; varje meddelande godkänns manuellt (avsiktligt för MVP).
- **Påminnelser för obesvarade leads** skapas när någon i företaget öppnar översikten (`refresh_follow_ups`). För schemalagd körning: lägg till `pg_cron` som anropar funktionen per organisation.
- **AI-analys startar manuellt** (knappen "Analysera") för att skydda AI-kvoten mot spam via formuläret.
- **Aviseringar** "kundsvar på offert" och "daglig sammanfattning" är förberedda i inställningarna men skickas inte än.
- **Logotypuppladdning** saknas (logotyp anges som https-URL). PDF:en visar logotyp-URL:en i dag inte som bild.
- **ROT-taket** (50 000 kr/person/år) beräknas inte, utan visas som en upplysning. ROT-procenten är konfigurerbar och måste hållas aktuell.
- **Integritetspolicy och villkor** är utkast med platshållare och måste granskas juridiskt. Kontaktadressen `hej@offertfabriken.se` på marknadssidan är en platshållare.
- Riktiga AI-, Resend- och Stripe-anrop har inte körts i den här miljön (inga nycklar). De är implementerade enligt API:erna, men demolägena är det som har testats end-to-end.
- PDF använder standardtypsnittet Helvetica (WinAnsi). Tecken utanför den teckenuppsättningen (t.ex. emoji) ersätts med `?`.

## Checklista för produktion

- [ ] Supabase-projekt i EU-region, PUB-avtal med Supabase och AI-leverantören
- [ ] `ALLOWED_ORIGINS` satt till produktionsdomänen, unikt `RATE_LIMIT_SALT`
- [ ] Egen SMTP för Auth samt verifierad Resend-domän
- [ ] Captcha (Supabase Auth hCaptcha/Turnstile) för registrering
- [ ] Stripe testat i testläge: köp, uppgradering, nedgradering, misslyckad betalning, uppsägning
- [ ] Backup/PITR aktiverat i Supabase
- [ ] `npx supabase test db` och E2E-skripten gröna mot staging
- [ ] Juridiskt granskade villkor, integritetspolicy och cookie-/spårningspolicy
- [ ] Övervakning av edge function-loggar och `usage_records` (AI-kostnad)
- [ ] Service role-nyckeln finns bara i edge functions, aldrig i frontend
