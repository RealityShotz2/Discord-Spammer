# Affärssystem – prislistor, avtalskunder, order och kundportal

Ett **tillägg** till Offertfabriken för företag som säljer till fasta priser och har återkommande kunder (grossister, livsmedel, lager, service med fasta timpriser). Inget i det befintliga offertflödet har bytts ut:

- Tjänstekatalogen (`services`), prisreglerna (`pricing_rules`) och AI-offertgeneratorn fungerar exakt som tidigare.
- Offertredigeraren har fått ett extra val, **Från prislista…**, som bara visas när kunden har en prislista.
- Planer och priser (399/899/1 799 kr) är oförändrade. Alla nya funktioner är påslagna på alla planer, men styrs av flaggor i `plans.features` (`price_lists`, `orders`, `recurring_orders`, `customer_portal`, `ai_orders`) som kontrolleras på servern via `has_feature()`. Att låsa en funktion till en viss plan är en ändring av en flagga.

## Funktioner

| Område | Sida | Vad det gör |
|---|---|---|
| Prislistor | `/app/prislistor` | Gemensamma eller kundspecifika listor med artikelnummer, enhet (kg, st, tim, liter, pall …), pris exkl. moms, momssats, giltighetstid och mängdrabatter. Sök, filtrera, duplicera (även till en kund). Varje pris- och momsändring loggas i `price_list_item_history`. Endast administratörer får ändra. |
| Avtalskunder | `/app/kunder` | Kundnummer (automatiskt), org.nr, flera kontaktpersoner, status, betalningsvillkor, kundrabatt, leverans- och fakturaadress, interna anteckningar, avtal med start/slut, uppsägningstid och automatisk förlängning, kundens prisbild, order och offerter, aktivitet. |
| Beställningar | `/app/bestallningar` | Order från kundens prisbild med exakta summor och moms per sats. Status `draft → pending_approval → confirmed → in_progress → delivered` (eller `cancelled`), statushistorik, duplicering med dagens priser, PDF-orderbekräftelse och utskick via e-post. |
| Återkommande order | `/app/bestallningar?flik=aterkommande` | Dagligen/veckovis/månadsvis med intervall, veckodagar eller dag i månaden (31 = sista dagen), start/slut, pausa/återuppta/avsluta. Ordern förbereds automatiskt X dagar innan och väntar på godkännande. |
| Kundportal | `/portal` | Kundens kontaktpersoner loggar in med e-post + lösenord, ser sina avtalade priser, lägger nya beställningar, beställer igen och laddar ner orderbekräftelser. |
| AI-orderassistent | Beställningar → *Ny order med AI* | Klistra in ett mejl/sms. AI hittar kund, artiklar, mängder, leveransdatum och referens och skapar ett **utkast**. |
| Översikt | `/app` | Aktiva kunder och avtal, order och ordervärde 30 dagar, order att hantera, kommande återkommande order och inaktiva kunder – från riktiga data. Visas när företaget börjat använda funktionerna. |
| Uppföljning | `/app/uppfoljning` | Nya uppgiftstyper: avtal som löper ut, återkommande order att godkänna, inaktiva kunder och portalorder. |
| Inställningar | `/app/installningar/order` | Prefix för ordernummer, gräns för inaktiv kund, påminnelsedagar och på/av för kundportalen. |

## Regler som aldrig bryts

- **Priser hittas aldrig på.** Orderrader får sitt pris från prislistan (med mängdrabatt) när de läggs till. Egna rader utan prislista har inget pris förrän någon fyller i det, och en order kan inte bekräftas så länge ett pris saknas.
- **Historiken skrivs aldrig över.** Order sparar en kopia av beskrivning, pris och moms. En prisändring i prislistan påverkar bara nya order. Bekräftade order är låsta (bara leveransdatum och interna anteckningar kan ändras).
- **Exakta belopp.** Alla belopp är `numeric(12,2)` och räknas i databasen (trigger), per momssats. Klientens förhandsvisning är bara en förhandsvisning.
- **AI bekräftar aldrig.** AI-schemat har inga prisfält. Artiklar som inte finns i kundens prislista får inget pris och en varning. Allt AI skapar är ett utkast. När AI själv identifierar kunden flyttas artiklarna till kundens egen prislista (`remapToCatalog`).
- **Inga dubbletter.** Återkommande order har en unik nyckel `(recurring_order_id, occurrence_date)`, raderna låses med `for update skip locked` och påminnelser har `dedupe_key`. Jobbet kan köras hur många gånger som helst.
- **Mänskligt godkännande.** Återkommande order och portalorder skapas som `pending_approval`. Alla användare i företaget kan bekräfta order.

## Säkerhet

- Alla nya tabeller har `organization_id`, RLS och sammansatta främmande nycklar `(id, organization_id)`.
- Status, nummer, summor och snapshot-fält kan inte sättas av klienten (kolumnrättigheter). Statusbyten sker bara via `set_order_status()`, som kontrollerar tillåtna övergångar.
- **Kundportalen** har en egen roll: portalanvändare är *inte* medlemmar i företaget och har ingen direkt åtkomst till tabellerna. Allt går via `SECURITY DEFINER`-funktioner (`portal_*`) som kontrollerar `customer_portal_users` (inbjudan accepterad, inte avstängd, portalen påslagen, funktionen ingår i planen). Kunden ser aldrig utkast, interna anteckningar eller andra kunders data. Portalorder prissätts på servern (klientens priser ignoreras) och begränsas till 20 per timme och 100 rader.
- Inbjudningar kopplas bara till en användare vars e-post är **bekräftad** och matchar inbjudan.

## Dagligt jobb

`pg_cron`-jobbet `offertfabriken-dagligt` kör `run_daily_jobs()` kl. 04:15 UTC. Det förlänger eller avslutar avtal, skapar påminnelser om avtal som löper ut och inaktiva kunder, och förbereder återkommande order. Samma logik (`refresh_business`) körs också när översikten eller beställningssidan öppnas, så att allt är aktuellt även utan cron.

## Databas

Migrationer: `20261110000001_business_enums.sql`, `…02_business_core.sql`, `…03_recurring_orders.sql`, `…04_customer_portal.sql`.

Viktiga funktioner: `price_catalog_for(cust)` (kundlista > avtalslista > standardlista), `effective_unit_price(item, qty)`, `set_order_status`, `duplicate_order`, `order_from_quotation`, `duplicate_price_list`, `generate_recurring_orders`, `refresh_business`, `business_stats`, `portal_access`, `portal_catalog`, `portal_orders`, `portal_create_order`, `portal_reorder`, `portal_order_document`.

Edge functions: `send-order` (orderbekräftelse som PDF via e-post) och `portal-invite` (inbjudan till kundportalen). `ai` har fått uppgiften `order_draft`.

## Tester

| Test | Antal | Täcker |
|---|---|---|
| `supabase/tests/business.test.sql` | 74 | Kundnummer, prisbild och prioritet, mängdrabatt, behörigheter, summor/moms, låsning, historik, isolering, återkommande order (idempotens, månadsslut), avtalspåminnelser, portalisolering och manipulering |
| `src/business.test.ts` | 14 | Schemaregler (intervall, månadsslut, skottår, sommartid), mängdrabatt, AI-order utan påhittade priser, omflyttning till kundlista, demoläge, PDF |
| `scripts/e2e-business.mjs` | 41 | Hela flödet via API och edge functions, inkl. portal och isolering mellan företag |
| `scripts/e2e-business-ui.mjs` | 11 | Hela flödet i webbläsaren, inkl. kundportalen i mobilvy |
