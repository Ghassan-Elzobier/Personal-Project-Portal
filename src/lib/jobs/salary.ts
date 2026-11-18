// A role's salary as a yearly range in pence, read from the advert's salary text
// ("£80K", "GBP 45000 to 55000", "£45k–£55k", "£400 per day"). Pure, so it is tested.
// Only pounds: another currency, or no currency at all, gives nothing rather than a guess.

/** Working days and hours in a year, for day and hourly rates. */
const DAYS_A_YEAR = 230;
const HOURS_A_YEAR = 1950;

export type Salary = { minPence: number; maxPence: number };

export function salaryOf(text: string | null | undefined): Salary | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, "");
  if (!/£|gbp/.test(t)) return null;
  const per = /per hour|\/\s*h(ou)?r\b|hourly|an hour/.test(t)
    ? HOURS_A_YEAR
    : /per day|\/\s*day\b|daily|a day/.test(t)
      ? DAYS_A_YEAR
      : 1;
  const yearly = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k)?\b/g)]
    .map((m) => Number(m[1]) * (m[2] ? 1000 : 1) * per)
    .filter((n) => n >= 10_000 && n <= 1_000_000);
  if (!yearly.length) return null;
  return { minPence: Math.round(Math.min(...yearly) * 100), maxPence: Math.round(Math.max(...yearly) * 100) };
}
