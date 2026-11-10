// UI-test av affärssystemet: kunder, prislistor, order, återkommande order, översikt och kundportal (även mobil).
// Kräver: npx supabase start, npx supabase functions serve, npm run dev (port 5173).
// Kör: node scripts/e2e-business-ui.mjs [skärmdumpsmapp]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const OUT = process.argv[2] ?? "test-results";
execSync(`mkdir -p ${OUT}`);
const APP = "http://localhost:5173";
const status = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const owner = `agare${stamp}@vastkustfisk.test`, buyer = `inkop${stamp}@fiskhandeln.test`, PW = "Sakert-Losen-2026";
let step = 0;
const log = (m) => console.log(`✓ ${String(++step).padStart(2, "0")} ${m}`);

// Testdata: företag med prislista och en avtalskund (skapas som ägaren, via RLS)
await admin.auth.admin.createUser({ email: owner, password: PW, email_confirm: true });
const a = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
await a.auth.signInWithPassword({ email: owner, password: PW });
const { data: orgId } = await a.rpc("create_organization", { p: { name: "Västkust Fisk AB", city: "Göteborg" } });
await a.from("organization_settings").update({ onboarding_completed: true }).eq("organization_id", orgId);
const { data: pl } = await a.from("price_lists").insert({ organization_id: orgId, name: "Standard 2026", is_default: true }).select("id").single();
const { data: items } = await a.from("price_list_items").insert([
  { organization_id: orgId, price_list_id: pl.id, sku: "RAK-1", name: "Räkor kokta", unit: "kg", unit_price: 189, vat_rate: 12 },
  { organization_id: orgId, price_list_id: pl.id, sku: "LAX-1", name: "Laxfilé", unit: "kg", unit_price: 245.5, vat_rate: 12 },
]).select("id,sku");
await a.from("price_list_item_tiers").insert({ organization_id: orgId, item_id: items[0].id, min_quantity: 500, unit_price: 169 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "sv-SE", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); };
watch(page);
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });

await page.goto(`${APP}/logga-in`);
await page.getByLabel("E-post").fill(owner);
await page.getByLabel("Lösenord").fill(PW);
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL(/\/app$/);
for (const name of ["Kunder", "Beställningar", "Prislistor"]) await page.getByRole("link", { name, exact: true }).first().waitFor();
log("Nya menyval: Kunder, Beställningar, Prislistor");

// Prislistor
await page.getByRole("link", { name: "Prislistor", exact: true }).first().click();
await page.getByText("Standard 2026").waitFor();
await page.getByText("Standard 2026").click();
await page.locator('input[value="Räkor kokta"], :text("Räkor kokta")').first().waitFor();
await shot(page, "b01-prislista");
log("Prislista med artiklar visas");

// Ny kund
await page.goto(`${APP}/app/kunder`);
await page.getByRole("button", { name: "Ny kund" }).first().click();
await page.getByLabel("Kundnamn *").fill("Fiskhandeln i Borås AB");
await page.getByLabel("Organisationsnummer").fill("5566778899");
await page.getByLabel("E-post").fill(buyer);
await page.getByRole("button", { name: "Skapa kund" }).click();
await page.waitForURL(/\/app\/kunder\/[0-9a-f-]{36}/);
await page.getByRole("heading", { name: "Fiskhandeln i Borås AB" }).waitFor();
await shot(page, "b02-kundprofil");
const customerId = page.url().split("/").pop();
log("Ny kund skapas och kundprofilen öppnas");

// Ny order via dialog → orderredigerare
await page.goto(`${APP}/app/bestallningar?ny=1&kund=${customerId}`);
await page.getByRole("button", { name: "Skapa order" }).click();
await page.waitForURL(/\/app\/bestallningar\/[0-9a-f-]{36}$/);
await page.getByLabel("Artikel från prislista").selectOption({ label: /Räkor kokta/ }).catch(async () => {
  const opt = await page.getByLabel("Artikel från prislista").locator("option", { hasText: "Räkor kokta" }).getAttribute("value");
  await page.getByLabel("Artikel från prislista").selectOption(opt);
});
await page.getByLabel("Mängd").last().fill("500");
await page.getByRole("button", { name: /Lägg till.*169/ }).click();
await page.getByText(/94\s?640,00/).first().waitFor(); // 500 × 169 + 12 % moms
log("Orderrad från prislistan med mängdrabatt – totalsumma inkl. moms stämmer");
await page.getByRole("button", { name: "Bekräfta order" }).click();
await page.getByText("Låst").waitFor();
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
if (!/Orderbekraftelse-ORD-\d+\.pdf/.test(download.suggestedFilename())) throw new Error("Fel PDF-namn: " + download.suggestedFilename());
await shot(page, "b03-order-bekraftad");
log("Order bekräftas, låses och orderbekräftelse laddas ner som PDF");

// Återkommande order
await page.goto(`${APP}/app/bestallningar/aterkommande/ny?kund=${customerId}`);
await page.getByLabel("Benämning *").fill("Räkor varje måndag");
const opt = await page.getByLabel("Artikel från prislista").locator("option", { hasText: "Räkor kokta" }).getAttribute("value");
await page.getByLabel("Artikel från prislista").selectOption(opt);
await page.getByLabel("Mängd").last().fill("100");
await page.getByRole("button", { name: /Lägg till/ }).click();
await page.getByText(/Varje måndag/).first().waitFor();
await page.getByRole("button", { name: "Skapa", exact: true }).click();
await page.waitForURL(/aterkommande\/[0-9a-f-]{36}$/);
await page.getByRole("button", { name: "Pausa" }).waitFor();
await shot(page, "b04-aterkommande");
log("Återkommande beställning skapas med förhandsvisning av tillfällen");

// Översikt med affärs-KPI:er
await page.goto(`${APP}/app`);
await page.getByText("Avtalskunder & order").waitFor();
await page.getByText("Order 30 dagar").waitFor();
await shot(page, "b05-oversikt");
log("Översikten visar affärs-KPI:er från riktiga data");

// Kundportal: slå på, bjud in, kunden loggar in i mobil
await a.from("organization_settings").update({ portal_enabled: true }).eq("organization_id", orgId);
await page.goto(`${APP}/app/kunder/${customerId}`);
await page.getByRole("tab", { name: /Kundportal/ }).click();
await page.getByRole("heading", { name: "Bjud in till kundportalen" }).waitFor();
await page.getByLabel("E-post", { exact: true }).last().fill(buyer);
await page.getByRole("button", { name: "Skicka inbjudan" }).click();
await page.getByText(buyer).first().waitFor();
log("Kontaktperson bjuds in till kundportalen");

await admin.auth.admin.createUser({ email: buyer, password: PW, email_confirm: true });
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE" });
const m = await mctx.newPage();
watch(m);
await m.goto(`${APP}/portal`);
await m.waitForURL(/logga-in\?till=%2Fportal|logga-in\?till=\/portal/);
await m.getByRole("heading", { name: "Logga in i kundportalen" }).waitFor();
await m.getByLabel("E-post").fill(buyer);
await m.getByLabel("Lösenord").fill(PW);
await m.getByRole("button", { name: "Logga in" }).click();
await m.waitForURL(/\/portal$/);
await m.getByRole("heading", { name: /Välkommen, Fiskhandeln/ }).waitFor();
await m.getByLabel("Mängd Laxfilé").fill("10");
await m.getByRole("button", { name: "Skicka beställning" }).click();
await m.getByText(/Väntar på godkännande/).first().waitFor();
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await m.screenshot({ path: `${OUT}/b06-portal-mobil.png` });
if (overflow) throw new Error("Horisontell scroll i kundportalen på mobil");
log("Kunden loggar in i portalen på mobil och lägger en beställning");

await m.getByText(/ORD-\d+/).first().click();
await m.getByRole("button", { name: "Beställ igen" }).first().click();
await m.getByText(/är skickad för bekräftelse/).first().waitFor();
log("Kunden beställer igen från en tidigare order");

// Företaget ser portalordern som uppgift
await page.goto(`${APP}/app/uppfoljning`);
await page.getByText(/via kundportalen/).first().waitFor();
await shot(page, "b07-uppfoljning");
log("Portalordern dyker upp som uppgift att godkänna");

await browser.close();
if (errors.length) { console.log("\nKonsolfel:\n" + [...new Set(errors)].join("\n")); process.exit(1); }
console.log(`\nAlla ${step} UI-steg för affärssystemet godkända. Skärmdumpar i ${OUT}/`);
