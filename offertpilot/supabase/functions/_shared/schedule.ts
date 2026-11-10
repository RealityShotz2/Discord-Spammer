// Datumregler för återkommande beställningar. Speglar public.recurring_next() i databasen
// (databasen är auktoritativ; detta används för förhandsvisning i gränssnittet och testas mot samma fall).
export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleRule {
  frequency: Frequency;
  interval: number;
  weekdays?: number[] | null; // 1 = måndag … 7 = söndag
  dayOfMonth?: number | null;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const isoDow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
const weekStart = (d: Date) => addDays(d, 1 - isoDow(d));
const lastDayOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

export function matches(rule: ScheduleRule, d: Date): boolean {
  const start = toDate(rule.startDate);
  if (d < start) return false;
  const every = Math.max(1, rule.interval);
  if (rule.frequency === "daily") return Math.round((d.getTime() - start.getTime()) / 86400000) % every === 0;
  if (rule.frequency === "weekly") {
    const weeks = Math.round((weekStart(d).getTime() - weekStart(start).getTime()) / (7 * 86400000));
    const days = rule.weekdays?.length ? rule.weekdays : [isoDow(start)];
    return weeks % every === 0 && days.includes(isoDow(d));
  }
  const months = (d.getUTCFullYear() * 12 + d.getUTCMonth()) - (start.getUTCFullYear() * 12 + start.getUTCMonth());
  const dom = rule.dayOfMonth ?? start.getUTCDate();
  return months % every === 0 && d.getUTCDate() === Math.min(dom, lastDayOfMonth(d));
}

/** Första tillfälle på eller efter fromDate, eller null om schemat har tagit slut. */
export function nextOccurrence(rule: ScheduleRule, fromDate: string): string | null {
  let d = toDate(fromDate < rule.startDate ? rule.startDate : fromDate);
  for (let i = 0; i <= 800; i++) {
    if (rule.endDate && toStr(d) > rule.endDate) return null;
    if (matches(rule, d)) return toStr(d);
    d = addDays(d, 1);
  }
  return null;
}

/** De kommande n tillfällena, för förhandsvisning. */
export function upcoming(rule: ScheduleRule, fromDate: string, n = 4): string[] {
  const out: string[] = [];
  let from = fromDate;
  while (out.length < n) {
    const next = nextOccurrence(rule, from);
    if (!next) break;
    out.push(next);
    from = toStr(addDays(toDate(next), 1));
  }
  return out;
}

const DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
export function describeSchedule(rule: ScheduleRule): string {
  const every = Math.max(1, rule.interval);
  if (rule.frequency === "daily") return every === 1 ? "Varje dag" : `Var ${every}:e dag`;
  if (rule.frequency === "weekly") {
    const days = (rule.weekdays?.length ? rule.weekdays : [isoDow(toDate(rule.startDate))]).slice().sort().map((d) => DAYS[d - 1]);
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} och ${days[days.length - 1]}` : days[0];
    return every === 1 ? `Varje ${list}` : every === 2 ? `Varannan vecka, ${list}` : `Var ${every}:e vecka, ${list}`;
  }
  const dom = rule.dayOfMonth ?? toDate(rule.startDate).getUTCDate();
  const day = dom >= 31 ? "sista dagen" : `den ${dom}:e`;
  return every === 1 ? `Varje månad, ${day}` : `Var ${every}:e månad, ${day}`;
}
