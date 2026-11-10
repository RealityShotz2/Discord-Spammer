// End-to-end-test av affärssystemet (prislistor, avtalskunder, order, återkommande order, kundportal, AI-order)
// mot lokal Supabase. Kör: npx supabase start && npx supabase functions serve, sedan node scripts/e2e-business.mjs
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const status = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const URL = status.API_URL, ANON = status.ANON_KEY, SERVICE = status.SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let failures = 0;
const ok = (cond, label, extra) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) { failures++; if (extra !== undefined) console.log("   ", JSON.stringify(extra)); } };
const PW = "Testlosen123";

async function newUser(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signUp({ email, password: PW });
  if (error) throw error;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  await admin.auth.admin.updateUserById(list.users.find((x) => x.email === email).id, { email_confirm: true });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PW });
  if (e2) throw e2;
  return c;
}
const fn = async (c, name, body) => {
  const { data: s } = await c.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON, ...(s?.session ? { authorization: `Bearer ${s.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const stamp = Date.now();

// ---------------------------------------------------------------- företag, tjänstekatalogen lämnas orörd
const a = await newUser(`fisk${stamp}@grossist.test`);
const { data: orgId } = await a.rpc("create_organization", { p: { name: "Västkust Fisk AB", city: "Göteborg" } });
ok(!!orgId, "skapa företag");
await a.from("services").insert({ organization_id: orgId, name: "Utkörning", unit: "st", unit_price: 450 });
const { data: svcBefore } = await a.from("services").select("id,unit_price").eq("organization_id", orgId);

// ---------------------------------------------------------------- prislista med mängdrabatt
const { data: pl, error: plErr } = await a.from("price_lists").insert({ organization_id: orgId, name: "Standard 2026", is_default: true }).select("id").single();
ok(!plErr, "skapa standardprislista", plErr);
const { data: items, error: itErr } = await a.from("price_list_items").insert([
  { organization_id: orgId, price_list_id: pl.id, sku: "RAK-1", name: "Räkor kokta", unit: "kg", unit_price: 189, vat_rate: 12 },
  { organization_id: orgId, price_list_id: pl.id, sku: "LAX-1", name: "Laxfilé", unit: "kg", unit_price: 245.5, vat_rate: 12 },
  { organization_id: orgId, price_list_id: pl.id, sku: "PALL", name: "Pallhyra", unit: "pall", unit_price: 95, vat_rate: 25 },
]).select("id,sku");
ok(!itErr && items.length === 3, "lägg till artiklar (kg, pall)", itErr);
const rak = items.find((i) => i.sku === "RAK-1").id, lax = items.find((i) => i.sku === "LAX-1").id;
const { error: tierErr } = await a.from("price_list_item_tiers").insert({ organization_id: orgId, item_id: rak, min_quantity: 500, unit_price: 169 });
ok(!tierErr, "mängdrabatt från 500 kg", tierErr);

// ---------------------------------------------------------------- avtalskund med kundpris
const { data: cust, error: cErr } = await a.from("customers").insert({ organization_id: orgId, name: "Fiskhandeln i Borås AB", email: `inkop${stamp}@fiskhandeln.test`, customer_type: "company", status: "active", payment_terms_days: 15 }).select("id,customer_number").single();
ok(!cErr && cust.customer_number >= 1000, "kund får kundnummer automatiskt", cErr ?? cust);
const { data: contact } = await a.from("customer_contacts").insert({ organization_id: orgId, customer_id: cust.id, name: "Anna Inköp", email: `anna${stamp}@fiskhandeln.test`, is_primary: true }).select("id").single();
ok(!!contact, "kontaktperson");
const { data: custPl } = await a.rpc("duplicate_price_list", { pl: pl.id, new_name: "Fiskhandeln avtal", for_customer: cust.id });
await a.from("price_list_items").update({ unit_price: 239 }).eq("price_list_id", custPl).eq("sku", "LAX-1");
const { error: agErr } = await a.from("customer_agreements").insert({ organization_id: orgId, customer_id: cust.id, title: "Ramavtal 2026", start_date: "2026-01-01", end_date: "2026-12-31", price_list_id: custPl, status: "active", notice_days: 60 });
ok(!agErr, "avtal med start/slut och kundprislista", agErr);
const { data: catalog } = await a.rpc("customer_price_catalog", { cust: cust.id });
const laxRow = catalog.find((c) => c.sku === "LAX-1");
ok(Number(laxRow.unit_price) === 239 && laxRow.customer_specific, "kundens avtalspris går före standardpriset", laxRow);

// ---------------------------------------------------------------- order: totals, moms, bekräftelse, låsning
const { data: order, error: oErr } = await a.from("orders").insert({ organization_id: orgId, customer_id: cust.id }).select("id,number,payment_terms_days").single();
ok(!oErr && /^ORD-\d+/.test(order.number) && order.payment_terms_days === 15, "order får nummer och kundens betalningsvillkor", oErr ?? order);
const custRak = catalog.find((c) => c.sku === "RAK-1"), custLax = catalog.find((c) => c.sku === "LAX-1");
await a.from("order_items").insert([
  { organization_id: orgId, order_id: order.id, price_list_item_id: custRak.item_id, sku: "RAK-1", description: "Räkor kokta", quantity: 500, unit: "kg", unit_price: 169, vat_rate: 12, sort: 1 },
  { organization_id: orgId, order_id: order.id, price_list_item_id: custLax.item_id, sku: "LAX-1", description: "Laxfilé", quantity: 12.5, unit: "kg", unit_price: 239, vat_rate: 12, sort: 2 },
]);
const { data: o1 } = await a.from("orders").select("subtotal,vat_total,total").eq("id", order.id).single();
ok(Number(o1.subtotal) === 87487.5 && Number(o1.vat_total) === 10498.5 && Number(o1.total) === 97986, "totals och moms räknas exakt på servern", o1);
const { error: confErr } = await a.rpc("set_order_status", { oid: order.id, new_status: "confirmed", note: null });
ok(!confErr, "bekräfta order", confErr);
const { error: lockErr } = await a.from("order_items").update({ quantity: 1 }).eq("order_id", order.id);
const { data: o2 } = await a.from("orders").select("total").eq("id", order.id).single();
ok(!!lockErr || Number(o2.total) === 97986, "bekräftad order är låst", lockErr);
const send = await fn(a, "send-order", { order_id: order.id });
ok(send.status === 200, "orderbekräftelse skickas (eller demoläge)", send);
// Prisändring i efterhand påverkar inte historiken
await a.from("price_list_items").update({ unit_price: 259 }).eq("id", custLax.item_id);
const { data: hist } = await a.from("order_items").select("unit_price").eq("order_id", order.id).eq("sku", "LAX-1").single();
const { data: ph } = await a.from("price_list_item_history").select("old_unit_price,new_unit_price").eq("item_id", custLax.item_id);
ok(Number(hist.unit_price) === 239 && (ph ?? []).some((h) => Number(h.new_unit_price) === 259), "prisändring loggas och gamla order behåller sitt pris", { hist, ph });
const { data: dup } = await a.rpc("duplicate_order", { oid: order.id });
const { data: dupLax } = await a.from("order_items").select("unit_price").eq("order_id", dup).eq("sku", "LAX-1").single();
ok(Number(dupLax.unit_price) === 259, "duplicerad order får dagens pris", dupLax);
const { data: hstat } = await a.from("order_status_history").select("to_status").eq("order_id", order.id);
ok(hstat.some((h) => h.to_status === "confirmed"), "statushistorik sparas");

// ---------------------------------------------------------------- återkommande order: idempotent generering
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const { data: rec, error: rErr } = await a.from("recurring_orders").insert({ organization_id: orgId, customer_id: cust.id, title: "Räkor dagligen", frequency: "daily", interval_count: 1, start_date: today, lead_days: 1 }).select("id,next_occurrence").single();
ok(!rErr && rec.next_occurrence === today, "återkommande order schemaläggs", rErr ?? rec);
await a.from("recurring_order_items").insert({ organization_id: orgId, recurring_order_id: rec.id, price_list_item_id: custRak.item_id, sku: "RAK-1", description: "Räkor kokta", quantity: 100, unit: "kg", vat_rate: 12 });
const g1 = await a.rpc("refresh_business", { org: orgId });
const g2 = await a.rpc("refresh_business", { org: orgId });
const { data: recOrders } = await a.from("orders").select("id,status,source,occurrence_date").eq("recurring_order_id", rec.id);
ok(!g1.error && !g2.error && recOrders.length >= 1 && new Set(recOrders.map((r) => r.occurrence_date)).size === recOrders.length, "generering skapar order utan dubbletter vid upprepade körningar", { g1: g1.error, recOrders });
ok(recOrders.every((r) => r.status === "pending_approval" && r.source === "recurring"), "återkommande order väntar på godkännande");
await a.from("recurring_orders").update({ status: "paused" }).eq("id", rec.id);
const { data: paused } = await a.from("recurring_orders").select("next_occurrence").eq("id", rec.id).single();
ok(paused.next_occurrence === null, "pausad återkommande order har inget nästa tillfälle");
const { error: apprErr } = await a.rpc("set_order_status", { oid: recOrders[0].id, new_status: "confirmed", note: "Godkänd" });
ok(!apprErr, "godkänn förberedd order", apprErr);

// ---------------------------------------------------------------- dashboard
const { data: bs, error: bsErr } = await a.rpc("business_stats", { org: orgId });
ok(!bsErr && bs.has_business && bs.active_customers === 1 && bs.active_agreements === 1 && bs.orders_30d >= 3, "affärs-KPI:er från riktiga data", bsErr ?? bs);

// ---------------------------------------------------------------- AI-orderassistent (demoläge utan nyckel)
const ai = await fn(a, "ai", { task: "order_draft", organization_id: orgId, text: `Hej! Fiskhandeln i Borås AB vill ha 600 kg räkor och 10 kg laxfilé till ${today}. Ordernr: PO-77`, customer_id: null });
ok(ai.status === 200 && ai.body.order_id, "AI skapar orderutkast från inklistrad text", ai);
if (ai.body?.order_id) {
  const { data: aiItems } = await a.from("order_items").select("sku,quantity,unit_price").eq("order_id", ai.body.order_id).order("sort");
  const { data: aiOrder } = await a.from("orders").select("status,ai_generated,customer_id").eq("id", ai.body.order_id).single();
  ok(aiOrder.status === "draft" && aiOrder.ai_generated && aiOrder.customer_id === cust.id, "AI-order är ett utkast, aldrig bekräftad", aiOrder);
  ok(aiItems.find((i) => i.sku === "RAK-1" && Number(i.unit_price) === 169) && aiItems.find((i) => i.sku === "LAX-1" && Number(i.unit_price) === 259), "AI-orderns priser kommer från prislistan (inkl. mängdrabatt)", aiItems);
}

// ---------------------------------------------------------------- kundportal
const inviteOff = await fn(a, "portal-invite", { customer_id: cust.id, email: `anna${stamp}@fiskhandeln.test` });
ok(inviteOff.status === 400, "inbjudan kräver att portalen är påslagen", inviteOff);
await a.from("organization_settings").update({ portal_enabled: true }).eq("organization_id", orgId);
const invite = await fn(a, "portal-invite", { customer_id: cust.id, email: `anna${stamp}@fiskhandeln.test`, contact_id: contact.id });
ok(invite.status === 200 && invite.body.invited, "bjud in kontaktperson till portalen", invite);
const p = await newUser(`anna${stamp}@fiskhandeln.test`);
const { data: accepted } = await p.rpc("accept_portal_invitations");
const { data: access } = await p.rpc("portal_access");
ok(accepted === 1 && access.length === 1 && access[0].customer_id === cust.id, "kunden kopplas vid inloggning", { accepted, access });
const { data: pCat } = await p.rpc("portal_catalog", { cust: cust.id });
ok(pCat.length === 3 && Number(pCat.find((c) => c.sku === "LAX-1").unit_price) === 259, "kunden ser sina avtalade priser");
const { data: pOrders } = await p.rpc("portal_orders", { cust: cust.id });
ok(pOrders.every((o) => o.status !== "draft" && !("notes_internal" in o)), "kunden ser inga utkast eller interna anteckningar");
const { data: po, error: poErr } = await p.rpc("portal_create_order", { cust: cust.id, items: [{ item_id: custRak.item_id, quantity: 50, unit_price: 1 }], requested_delivery_date: null, customer_reference: "Portal-1", notes: null });
const { data: poItems } = await a.from("order_items").select("unit_price").eq("order_id", po?.id);
ok(!poErr && Number(poItems?.[0]?.unit_price) === 189, "portalorder prissätts på servern (kundens pris ignoreras)", poErr ?? poItems);
const { data: poTask } = await a.from("follow_up_tasks").select("kind").eq("order_id", po?.id);
ok(poTask?.[0]?.kind === "order_approval", "företaget får en uppgift att godkänna portalordern");
const { data: re, error: reErr } = await p.rpc("portal_reorder", { cust: cust.id, source_order: order.id });
ok(!reErr && re.id, "kunden kan beställa igen från tidigare order", reErr);
const { data: docu, error: docErr } = await p.rpc("portal_order_document", { cust: cust.id, oid: order.id });
ok(!docErr && docu.order.number === order.number && docu.items.length === 2, "kunden kan hämta orderbekräftelse", docErr);
const { data: pDirect } = await p.from("orders").select("id");
const { data: pPl } = await p.from("price_lists").select("id");
ok((pDirect ?? []).length === 0 && (pPl ?? []).length === 0, "portalanvändare kommer inte åt företagets tabeller direkt");

// Annat företag och annan kund
const b = await newUser(`annan${stamp}@grossist.test`);
const { data: orgB } = await b.rpc("create_organization", { p: { name: "Annan Grossist AB" } });
const { data: bCust } = await b.from("customers").insert({ organization_id: orgB, name: "B-kund" }).select("id").single();
const { error: pSteal } = await p.rpc("portal_catalog", { cust: bCust.id });
ok(!!pSteal, "portalanvändare kan inte läsa en annan kunds priser", pSteal);
const { data: bSee } = await b.from("orders").select("id").eq("organization_id", orgId);
const { data: bPl } = await b.from("price_lists").select("id").eq("organization_id", orgId);
ok(bSee.length === 0 && bPl.length === 0, "annat företag ser inga order eller prislistor");
const { error: bOrderErr } = await b.from("orders").insert({ organization_id: orgB, customer_id: cust.id });
ok(!!bOrderErr, "annat företag kan inte skapa order på någon annans kund", bOrderErr);
const bSend = await fn(b, "send-order", { order_id: order.id });
ok(bSend.status === 404, "annat företag kan inte skicka någon annans orderbekräftelse", bSend);

// Inaktiverad portalåtkomst
await a.from("customer_portal_users").update({ disabled_at: new Date().toISOString() }).eq("customer_id", cust.id);
const { data: accessAfter } = await p.rpc("portal_access");
ok(accessAfter.length === 0, "avstängd portalanvändare förlorar åtkomst");

// Tjänstekatalogen är orörd
const { data: svcAfter } = await a.from("services").select("id,unit_price").eq("organization_id", orgId);
ok(JSON.stringify(svcAfter) === JSON.stringify(svcBefore), "befintlig tjänstekatalog påverkas inte av prislistor");

console.log(failures ? `\n${failures} test misslyckades` : "\nAlla affärssystemstester godkända");
process.exit(failures ? 1 : 0);
