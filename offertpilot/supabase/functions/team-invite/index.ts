// POST /functions/v1/team-invite – bjuder in en kollega (endast admin, platsgräns enligt plan).
import { z } from "zod";
import { appUrl, handler, HttpError, json, rateLimit, readJson, requireUser } from "../_shared/http.ts";
import { emailConfigured, sendEmail, textToHtml } from "../_shared/email.ts";

const Body = z.object({
  organization_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["admin", "employee"]),
});

Deno.serve(handler(["POST"], async (req) => {
  const user = await requireUser(req);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Ange en giltig e-postadress");
  await rateLimit(`invite:user:${user.userId}`, 10, 3600);
  const { organization_id, email, role } = parsed.data;

  // RPC:n kontrollerar admin-roll och platsgräns på serversidan
  const { error } = await user.db.rpc("invite_member", { org: organization_id, invite_email: email, invite_role: role });
  if (error) throw error;

  const { data: org } = await user.db.from("organizations").select("name").eq("id", organization_id).single();
  const link = `${appUrl()}/registrera?email=${encodeURIComponent(email)}&inbjudan=1`;
  const text = `Hej!\n\nDu har blivit inbjuden att gå med i ${org?.name ?? "ett företag"} på Offertfabriken. Skapa ett konto (eller logga in) med den här e-postadressen så kopplas du till företaget automatiskt.\n\nInbjudan gäller i 14 dagar.`;
  if (!emailConfigured()) {
    return json(req, { invited: true, demo: true, link, message: "Demoläge: e-post är inte konfigurerad. Skicka länken till din kollega själv." });
  }
  const res = await sendEmail({ to: email, subject: `Inbjudan till ${org?.name ?? "Offertfabriken"}`, text: `${text}\n\n${link}`, html: textToHtml(text, { cta: { label: "Gå med", url: link } }) });
  if (res.status === "failed") throw new HttpError(502, "Inbjudan sparades men e-posten kunde inte skickas");
  return json(req, { invited: true, demo: false });
}));
