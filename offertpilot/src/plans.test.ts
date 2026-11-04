import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { PLANS, formatPlanPrice, priceInclVat } from "@shared/plans.ts";

// Räknar fram planernas slutliga värden i databasen genom att läsa migreringarna i ordning
function plansFromMigrations() {
  const dir = "supabase/migrations";
  const db: Record<string, { price: number; users: number; leads: number }> = {};
  for (const f of readdirSync(dir).sort()) {
    const sql = readFileSync(`${dir}/${f}`, "utf8");
    for (const m of sql.matchAll(/\('(\w+)', '[^']+', (\d+), (\d+), (\d+),/g)) db[m[1]] = { price: +m[2], users: +m[3], leads: +m[4] };
    for (const m of sql.matchAll(/update public\.plans set price_sek = (\d+)\s+where id = '(\w+)'/g)) db[m[2]].price = +m[1];
  }
  return db;
}

describe("abonnemangsplaner", () => {
  it("har de nya priserna", () => {
    expect(PLANS.map((p) => [p.id, p.priceSek])).toEqual([["starter", 399], ["professional", 899], ["business", 1799]]);
  });
  it("stämmer med databasens priser och gränser", () => {
    const db = plansFromMigrations();
    for (const p of PLANS) expect(db[p.id]).toEqual({ price: p.priceSek, users: p.maxUsers, leads: p.maxAiLeadsPerMonth });
  });
  it("Professional är framhävd och funktionerna är oförändrade", () => {
    expect(PLANS.filter((p) => p.featured).map((p) => p.id)).toEqual(["professional"]);
    expect(PLANS.find((p) => p.id === "business")!.features).toContain("600 AI-assisterade leads/mån");
  });
  it("formaterar priser och moms", () => {
    expect(formatPlanPrice(1799).replace(/\s/g, " ")).toBe("1 799");
    expect([399, 899, 1799].map(priceInclVat)).toEqual([498.75, 1123.75, 2248.75]);
  });
});
