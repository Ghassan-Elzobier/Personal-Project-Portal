// Take-home pay from a salary, for England, Wales and Northern Ireland, so the budget
// can plan with pounds before the first payslip (and Jobs can show what a role pays
// after tax). Pure and dated: the rates are for one tax year, and a test fails once
// that year is over, as the reminder to bring them up to date.
//
// Sources (2026/27): GOV.UK "Income Tax rates and allowances for current and past
// years"; the personal allowance and basic rate limit are frozen to 5 April 2028
// (GOV.UK, "The personal allowance and basic rate limit ... from 6 April 2026");
// employee Class 1 NI at 8% and 2%; student loan thresholds from HMRC's "Rates and
// thresholds for employers 2026 to 2027". Amounts are pence a year.

export const TAX_YEAR = { from: "2026-04-06", to: "2027-04-05" };

const PERSONAL_ALLOWANCE = 1_257_000;
/** The allowance shrinks by £1 for every £2 earned over this. */
const TAPER_FROM = 10_000_000;
/** The basic rate band, above the allowance. */
const BASIC_BAND = 3_770_000;
const ADDITIONAL_FROM = 12_514_000;
const NI_FROM = 1_257_000;
const NI_UPPER = 5_027_000;

export type LoanPlan = "plan1" | "plan2" | "plan4" | "plan5" | "postgrad";

/** Each plan's yearly threshold and its rate. */
export const LOANS: Record<LoanPlan, { from: number; rate: number; name: string }> = {
  plan1: { from: 2_690_000, rate: 0.09, name: "Plan 1" },
  plan2: { from: 2_938_500, rate: 0.09, name: "Plan 2" },
  plan4: { from: 3_379_500, rate: 0.09, name: "Plan 4 (Scotland)" },
  plan5: { from: 2_500_000, rate: 0.09, name: "Plan 5" },
  postgrad: { from: 2_100_000, rate: 0.06, name: "Postgraduate" },
};

/**
 * How a workplace pension is taken: salary sacrifice (before tax and NI), net pay
 * (before tax only), or relief at source (from pay after tax, the scheme adding the
 * basic-rate relief, so it costs 80% of the contribution).
 */
export type PensionKind = "salary-sacrifice" | "net-pay" | "relief-at-source";

export type TakeHomeInput = {
  grossYearPence: number;
  pensionPercent?: number;
  pensionKind?: PensionKind;
  loans?: LoanPlan[];
};

export type TakeHome = {
  yearPence: number;
  monthPence: number;
  tax: number;
  ni: number;
  loans: number;
  pension: number;
};

const floor = (pence: number) => Math.floor(pence);

/** A salary's take-home a year and a month, with what goes on tax, NI, student loans and pension. */
export function takeHome(input: TakeHomeInput): TakeHome {
  const gross = Math.max(0, Math.round(input.grossYearPence));
  const pct = Math.min(100, Math.max(0, input.pensionPercent ?? 0)) / 100;
  const kind = input.pensionKind ?? "net-pay";
  const contribution = floor(gross * pct);
  const sacrifice = kind === "salary-sacrifice" ? contribution : 0;
  const niPay = gross - sacrifice;
  const taxable = gross - (kind === "relief-at-source" ? 0 : contribution);

  const allowance = Math.max(0, PERSONAL_ALLOWANCE - Math.max(0, Math.floor((taxable - TAPER_FROM) / 2)));
  const above = Math.max(0, taxable - allowance);
  const basic = Math.min(above, BASIC_BAND);
  const additional = Math.max(0, taxable - ADDITIONAL_FROM);
  const higher = Math.max(0, above - basic - additional);
  const tax = floor(basic * 0.2 + higher * 0.4 + additional * 0.45);

  const ni = floor(Math.max(0, Math.min(niPay, NI_UPPER) - NI_FROM) * 0.08 + Math.max(0, niPay - NI_UPPER) * 0.02);
  const loans = (input.loans ?? []).reduce(
    (s, plan) => s + floor(Math.max(0, niPay - LOANS[plan].from) * LOANS[plan].rate),
    0,
  );
  const pension = kind === "relief-at-source" ? floor(contribution * 0.8) : contribution;
  const yearPence = gross - tax - ni - loans - pension;
  return {
    yearPence,
    monthPence: Math.round(yearPence / 12),
    tax,
    ni,
    loans,
    pension,
  };
}
