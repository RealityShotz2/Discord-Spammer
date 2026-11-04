// E-post via Resend. Utan RESEND_API_KEY körs demoläge: inget skickas och anroparen informeras.
export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  fromName?: string | null;
  attachments?: { filename: string; content: Uint8Array }[];
}
export type EmailResult = { status: "sent"; id: string } | { status: "demo" } | { status: "failed"; error: string };

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function textToHtml(text: string, opts: { cta?: { label: string; url: string }; brand?: string | null } = {}): string {
  const color = /^#[0-9a-f]{6}$/i.test(opts.brand ?? "") ? opts.brand : "#4f46e5";
  const body = escapeHtml(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const cta = opts.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.cta.url)}" style="background:${color};color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(opts.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="sv"><body style="margin:0;background:#f4f5f8;font-family:Arial,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;padding:32px;font-size:15px"><tr><td>${body}${cta}</td></tr></table></td></tr></table></body></html>`;
}

export function emailConfigured(): boolean {
  return !!Deno.env.get("RESEND_API_KEY") && !!Deno.env.get("EMAIL_FROM");
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM"); // t.ex. "offert@dindoman.se"
  if (!key || !from) return { status: "demo" };
  const fromName = (input.fromName ?? "Offertfabriken").replace(/[<>"\r\n]/g, "").slice(0, 80);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${from}>`,
        to: [input.to],
        subject: input.subject.replace(/[\r\n]/g, " ").slice(0, 200),
        text: input.text,
        html: input.html ?? textToHtml(input.text),
        reply_to: input.replyTo ?? undefined,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content) })),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "failed", error: body?.message ?? `HTTP ${res.status}` };
    return { status: "sent", id: body.id };
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }
}
