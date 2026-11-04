// POST /functions/v1/billing – Stripe Checkout och kundportal (endast admin).
// Utan STRIPE_SECRET_KEY returneras demoläge; ingen betalning kan då genomföras.
import { z } from "zod";
import { adminClient, appUrl, handler, HttpError, json, readJson, requireMembership, requireUser } from "../_shared/http.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), organization_id: z.string().uuid(), plan_id: z.enum(["starter", "professional", "business"]) }),
  z.object({ action: z.literal("portal"), organization_id: z.string().uuid() }),
]);

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("stripe_error", body?.error?.message);
    throw new HttpError(502, "Betaltjänsten returnerade ett fel");
  }
  return body;
}

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  await requireMembership(user, parsed.data.organization_id, "admin");

  if (!Deno.env.get("STRIPE_SECRET_KEY")) {
    return json(req, { demo: true, message: "Betalningar är inte aktiverade i den här miljön (Stripe saknas). Ingen debitering sker." });
  }
  const admin = adminClient();
  const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id").eq("organization_id", parsed.data.organization_id).single();

  if (parsed.data.action === "portal") {
    if (!sub?.stripe_customer_id) throw new HttpError(400, "Det finns ingen aktiv betalning att hantera ännu");
    const session = await stripe("billing_portal/sessions", { customer: sub.stripe_customer_id, return_url: `${appUrl()}/app/installningar/fakturering` });
    return json(req, { url: session.url });
  }

  const { data: plan } = await admin.from("plans").select("id,stripe_price_id").eq("id", parsed.data.plan_id).single();
  const price = plan?.stripe_price_id ?? Deno.env.get(`STRIPE_PRICE_${parsed.data.plan_id.toUpperCase()}`);
  if (!price) throw new HttpError(400, "Planen saknar Stripe-pris. Konfigurera STRIPE_PRICE_* eller plans.stripe_price_id.");

  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: parsed.data.organization_id,
    "metadata[organization_id]": parsed.data.organization_id,
    "metadata[plan_id]": parsed.data.plan_id,
    "subscription_data[metadata][organization_id]": parsed.data.organization_id,
    "subscription_data[metadata][plan_id]": parsed.data.plan_id,
    success_url: `${appUrl()}/app/installningar/fakturering?status=klar`,
    cancel_url: `${appUrl()}/app/installningar/fakturering?status=avbruten`,
    locale: "sv",
    "automatic_tax[enabled]": "false",
    // Svensk moms läggs på priset (priserna är exkl. moms)
    "billing_address_collection": "required",
    "tax_id_collection[enabled]": "true",
    "allow_promotion_codes": "true",
  };
  const taxRate = Deno.env.get("STRIPE_TAX_RATE_ID");
  if (taxRate) params["line_items[0][tax_rates][0]"] = taxRate;
  if (sub?.stripe_customer_id) {
    params.customer = sub.stripe_customer_id;
    params["customer_update[address]"] = "auto";
    params["customer_update[name]"] = "auto";
  } else if (user.email) params.customer_email = user.email;
  const session = await stripe("checkout/sessions", params);
  return json(req, { url: session.url });
}));
