// Stripe-webhook: uppdaterar prenumerationer. Signaturen verifieras med STRIPE_WEBHOOK_SECRET.
import { adminClient } from "../_shared/http.ts";

async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((acc, c, i) => acc | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

const statusMap: Record<string, string> = {
  active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due",
  canceled: "canceled", incomplete: "incomplete", incomplete_expired: "canceled", paused: "past_due",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Stripe är inte konfigurerat", { status: 501 });
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get("stripe-signature") ?? "", secret))) {
    return new Response("Ogiltig signatur", { status: 400 });
  }
  const event = JSON.parse(payload);
  const admin = adminClient();
  const obj = event.data?.object ?? {};

  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const org = obj.metadata?.organization_id ?? obj.client_reference_id;
    if (org) {
      await admin.from("subscriptions").update({
        stripe_customer_id: obj.customer, stripe_subscription_id: obj.subscription,
        plan_id: obj.metadata?.plan_id ?? "starter", status: "active",
      }).eq("organization_id", org);
    }
  } else if (event.type?.startsWith("customer.subscription.")) {
    const org = obj.metadata?.organization_id;
    const update: Record<string, unknown> = {
      status: event.type === "customer.subscription.deleted" ? "canceled" : statusMap[obj.status] ?? "incomplete",
      stripe_subscription_id: obj.id,
      current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString()
        : obj.items?.data?.[0]?.current_period_end ? new Date(obj.items.data[0].current_period_end * 1000).toISOString() : null,
    };
    // Planen avgörs av priset (fungerar även när kunden byter plan i kundportalen).
    // 1) plan_id i prisets metadata – fungerar även för äldre, arkiverade priser
    // 2) aktuellt pris i plans.stripe_price_id  3) prenumerationens metadata
    const price = obj.items?.data?.[0]?.price;
    const validPlans = ["starter", "professional", "business"];
    let planId: string | null = validPlans.includes(price?.metadata?.plan_id) ? price.metadata.plan_id : null;
    if (!planId && price?.id) {
      const { data: plan } = await admin.from("plans").select("id").eq("stripe_price_id", price.id).maybeSingle();
      planId = plan?.id ?? null;
    }
    if (!planId && validPlans.includes(obj.metadata?.plan_id)) planId = obj.metadata.plan_id;
    if (planId) update.plan_id = planId;
    if (org && obj.customer) update.stripe_customer_id = obj.customer;
    const q = admin.from("subscriptions").update(update);
    await (org ? q.eq("organization_id", org) : q.eq("stripe_customer_id", obj.customer));
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
});
