// PDF-generering för offerter. Körs både i webbläsaren (nedladdning) och i edge functions (e-postbilaga).
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatNumber, formatSEK } from "./pricing.ts";

export interface PdfQuote {
  number: string;
  title: string;
  created_at: string;
  valid_until: string | null;
  intro: string | null;
  project_description: string | null;
  delivery_timeframe: string | null;
  terms: string | null;
  discount_type: string;
  discount_value: number;
  apply_rot: boolean;
  rot_percent: number;
  subtotal: number;
  discount_total: number;
  vat_total: number;
  total: number;
  rot_deduction: number;
  total_to_pay: number;
  status: string;
}
export interface PdfItem { description: string; quantity: number; unit: string; unit_price: number | null; discount_percent: number; vat_rate: number; line_total: number; is_labor: boolean }
export interface PdfOrg { name: string; org_number: string | null; email: string | null; phone: string | null; website: string | null; address: string | null; postal_code: string | null; city: string | null; brand_color: string | null }
export interface PdfCustomer { name: string; company_name: string | null; email: string | null; address: string | null; postal_code: string | null; city: string | null }

const A4 = { w: 595.28, h: 841.89 };
const M = 48;

function hexToRgb(hex: string | null) {
  const h = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : "#4f46e5";
  return rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
}

function sanitizer(font: PDFFont) {
  const allowed = new Set(font.getCharacterSet());
  return (text: string | null | undefined) =>
    (text ?? "")
      .replace(/[−]/g, "-").replace(/[  ]/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .split("").map((c) => (c === "\n" || allowed.has(c.codePointAt(0)!) ? c : "?")).join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("sv-SE") : "–");

export async function renderQuotePdf(args: { quote: PdfQuote; items: PdfItem[]; org: PdfOrg; customer: PdfCustomer; footer?: string | null; useBranding: boolean; draftWatermark?: boolean }): Promise<Uint8Array> {
  const { quote, items, org, customer } = args;
  const doc = await PDFDocument.create();
  doc.setTitle(`Offert ${quote.number} – ${org.name}`);
  doc.setAuthor(org.name);
  doc.setCreator("OffertPilot AI");
  doc.setLanguage("sv-SE");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = sanitizer(font);
  const accent = args.useBranding ? hexToRgb(org.brand_color) : rgb(0.2, 0.23, 0.33);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.4, 0.45, 0.53);
  const line = rgb(0.88, 0.9, 0.93);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const size = o.size ?? 10;
    const f = o.f ?? font;
    const str = clean(s);
    const dx = o.align === "right" ? f.widthOfTextAtSize(str, size) : 0;
    page.drawText(str, { x: x - dx, y: yy, size, font: f, color: o.color ?? ink });
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 40) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };
  const paragraph = (label: string, body: string | null) => {
    if (!body) return;
    ensure(40);
    text(label.toUpperCase(), M, y, { size: 8, f: bold, color: muted });
    y -= 14;
    for (const l of wrap(clean(body), font, 10, A4.w - 2 * M)) {
      ensure(14);
      text(l, M, y);
      y -= 14;
    }
    y -= 10;
  };

  // Sidhuvud
  page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: accent });
  text(org.name, M, y - 4, { size: 16, f: bold });
  text("OFFERT", A4.w - M, y - 4, { size: 16, f: bold, color: accent, align: "right" });
  y -= 22;
  const orgLines = [org.address, [org.postal_code, org.city].filter(Boolean).join(" "), org.org_number ? `Org.nr ${org.org_number}` : null].filter(Boolean) as string[];
  orgLines.forEach((l, i) => text(l, M, y - i * 12, { size: 9, color: muted }));
  const meta: [string, string][] = [["Offertnummer", quote.number], ["Datum", fmtDate(quote.created_at)], ["Giltig till", fmtDate(quote.valid_until)]];
  meta.forEach(([k, v], i) => {
    text(k, A4.w - M - 110, y - i * 12, { size: 9, color: muted });
    text(v, A4.w - M, y - i * 12, { size: 9, f: bold, align: "right" });
  });
  y -= Math.max(orgLines.length, meta.length) * 12 + 18;

  // Kund
  text("KUND", M, y, { size: 8, f: bold, color: muted });
  y -= 14;
  const custLines = [customer.company_name, customer.name, customer.address, [customer.postal_code, customer.city].filter(Boolean).join(" "), customer.email].filter(Boolean) as string[];
  custLines.forEach((l, i) => text(l, M, y - i * 13, { size: 10, f: i === 0 ? bold : font }));
  y -= custLines.length * 13 + 18;

  text(quote.title, M, y, { size: 14, f: bold });
  y -= 22;
  paragraph("Inledning", quote.intro);
  paragraph("Projektbeskrivning", quote.project_description);

  // Tabell
  const cols = { desc: M, qty: 330, unit: 370, price: 450, vat: 490, sum: A4.w - M };
  ensure(60);
  page.drawRectangle({ x: M - 6, y: y - 6, width: A4.w - 2 * M + 12, height: 20, color: rgb(0.96, 0.97, 0.98) });
  text("Beskrivning", cols.desc, y, { size: 8, f: bold, color: muted });
  text("Antal", cols.qty, y, { size: 8, f: bold, color: muted, align: "right" });
  text("Enhet", cols.unit, y, { size: 8, f: bold, color: muted });
  text("À-pris", cols.price, y, { size: 8, f: bold, color: muted, align: "right" });
  text("Moms", cols.vat, y, { size: 8, f: bold, color: muted });
  text("Summa", cols.sum, y, { size: 8, f: bold, color: muted, align: "right" });
  y -= 22;
  for (const it of items) {
    const descLines = wrap(clean(it.description + (it.discount_percent > 0 ? ` (rabatt ${formatNumber(it.discount_percent)} %)` : "") + (it.is_labor && quote.apply_rot ? " *" : "")), font, 9.5, cols.qty - cols.desc - 40);
    ensure(descLines.length * 12 + 10);
    descLines.forEach((l, i) => text(l, cols.desc, y - i * 12, { size: 9.5 }));
    text(formatNumber(it.quantity), cols.qty, y, { size: 9.5, align: "right" });
    text(it.unit, cols.unit, y, { size: 9.5 });
    text(it.unit_price === null ? "Pris saknas" : formatSEK(it.unit_price, { decimals: true }), cols.price, y, { size: 9.5, align: "right" });
    text(`${formatNumber(it.vat_rate)} %`, cols.vat, y, { size: 9.5 });
    text(formatSEK(it.line_total, { decimals: true }), cols.sum, y, { size: 9.5, align: "right" });
    y -= descLines.length * 12 + 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.5, color: line });
    y -= 8;
  }

  // Summering
  const totals: [string, number, boolean?][] = [["Summa exkl. moms", quote.subtotal]];
  if (quote.discount_total > 0) totals.push([quote.discount_type === "percent" ? `Rabatt (${formatNumber(quote.discount_value)} %)` : "Rabatt", -quote.discount_total]);
  totals.push(["Moms", quote.vat_total], ["Totalt inkl. moms", quote.total, true]);
  if (quote.apply_rot && quote.rot_deduction > 0) totals.push([`Preliminärt ROT-avdrag (${formatNumber(quote.rot_percent)} %)`, -quote.rot_deduction], ["Att betala efter ROT-avdrag", quote.total_to_pay, true]);
  ensure(totals.length * 16 + 20);
  y -= 6;
  for (const [k, v, strong] of totals) {
    text(k, cols.price - 40, y, { size: strong ? 11 : 10, f: strong ? bold : font, align: "right" });
    text(formatSEK(v, { decimals: true }), cols.sum, y, { size: strong ? 11 : 10, f: strong ? bold : font, align: "right" });
    y -= strong ? 18 : 15;
  }
  y -= 10;
  if (quote.apply_rot) {
    paragraph("ROT-avdrag", "* Arbetskostnad som omfattas av ROT. Avdraget är preliminärt och förutsätter att kunden har utrymme för skattereduktion hos Skatteverket.");
  }
  paragraph("Leveranstid", quote.delivery_timeframe);
  paragraph("Villkor", quote.terms);

  // Sidfot på alla sidor
  const footer = [org.name, org.email, org.phone, org.website].filter(Boolean).join("  ·  ");
  for (const [i, p] of doc.getPages().entries()) {
    p.drawLine({ start: { x: M, y: 44 }, end: { x: A4.w - M, y: 44 }, thickness: 0.5, color: line });
    p.drawText(clean(args.footer ? `${footer}  ·  ${args.footer}` : footer).slice(0, 140), { x: M, y: 30, size: 8, font, color: muted });
    p.drawText(`Sida ${i + 1} av ${doc.getPageCount()}`, { x: A4.w - M - 50, y: 30, size: 8, font, color: muted });
    if (args.draftWatermark) {
      p.drawText("UTKAST – EJ GODKÄND", { x: 110, y: 380, size: 46, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
    }
  }
  return await doc.save();
}
