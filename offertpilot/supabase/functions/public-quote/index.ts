// Publik offertvy för kunden via hemlig länk.
// GET ?token=… → offertdata, POST { token, accepted, note } → kundens svar
import { z } from "zod";
import { adminClient, handler, hashIp, HttpError, json, rateLimit, readJson } from "../_shared/http.ts";

const Token = z.string().regex(/^[a-f0-9]{48}$/);
const Respond = z.object({ token: Token, accepted: z.boolean(), note: z.string().trim().max(2000).optional() });

Deno.serve(handler(["GET", "POST"], async (req) => {
  const admin = adminClient();
  const ip = await hashIp(req);
  await rateLimit(`quote:${ip}`, 60, 60);

  if (req.method === "GET") {
    const token = Token.safeParse(new URL(req.url).searchParams.get("token"));
    if (!token.success) throw new HttpError(404, "Offerten hittades inte");
    const { data, error } = await admin.rpc("public_quote_view", { tok: token.data });
    if (error) throw error;
    if (!data) throw new HttpError(404, "Offerten hittades inte eller är inte längre tillgänglig");
    return json(req, data);
  }

  const parsed = Respond.safeParse(await readJson(req, 8000));
  if (!parsed.success) throw new HttpError(400, "Ogiltig förfrågan");
  await rateLimit(`quote:respond:${ip}`, 10, 600);
  const { error } = await admin.rpc("public_quote_respond", { tok: parsed.data.token, accepted: parsed.data.accepted, note: parsed.data.note ?? null });
  if (error) throw error;
  return json(req, { ok: true });
}));
