import { daysBetween, nextDue, yearlyPence, type Bill } from "./recurring.ts";

// Subscriptions in one place: the bills sorted as subscriptions, and learning and
// mentoring apart, with what they cost a month and the share of pay that is. Each
// asks "do you still want this?" when it hasn't been answered for 90 days, because
// a subscription nobody decides on keeps charging (inertia, not choice).

export const SUBSCRIPTIONS = "subscriptions";
export const LEARNING = "learning";
/** Days an answer lasts before the question comes back. */
export const REVIEW_DAYS = 90;

/** What a bill costs a month, on average over its year. */
export const monthlyPence = (b: Pick<Bill, "cadence" | "expectedPence">) => Math.round(yearlyPence(b) / 12);

/** What cancelling a bill gives back each week, on average over its year. */
export const weeklySaving = (b: Pick<Bill, "cadence" | "expectedPence">) => Math.round(yearlyPence(b) / 52);

/** Whether a bill should ask "keep or cancel?": never answered, or answered 90 days ago or more. */
export function reviewDue(b: Pick<Bill, "reviewedOn">, today: string): boolean {
  return !b.reviewedOn || daysBetween(b.reviewedOn, today) >= REVIEW_DAYS;
}

export type SubscriptionRow = {
  bill: Bill;
  /** Its next payment day. */
  due: string;
  monthly: number;
  /** Ask keep or cancel now. */
  ask: boolean;
  /** The owner said cancel, and it is still being paid. */
  cancelling: boolean;
  weeklySaving: number;
};

export type Subscriptions = {
  subscriptions: SubscriptionRow[];
  learning: SubscriptionRow[];
  /** Subscriptions a month (learning apart). */
  monthly: number;
  learningMonthly: number;
  /** Subscriptions' monthly cost as a whole percentage of the last pay, or null with no pay known. */
  shareOfPay: number | null;
  /** The other active bills, which can be sorted as a subscription or learning. */
  others: Bill[];
};

/** The active bills split into subscriptions, learning and the rest, each list next due first. */
export function subscriptions(bills: Bill[], today: string, lastPayPence: number | null): Subscriptions {
  const active = bills.filter((b) => b.status === "active");
  const rows = (key: string) =>
    active
      .filter((b) => b.category === key)
      .map((b): SubscriptionRow => ({
        bill: b,
        due: nextDue(b, today),
        monthly: monthlyPence(b),
        ask: reviewDue(b, today),
        cancelling: b.verdict === "cancel",
        weeklySaving: weeklySaving(b),
      }))
      .sort((x, y) => x.due.localeCompare(y.due) || x.bill.id - y.bill.id);
  const subs = rows(SUBSCRIPTIONS);
  const learning = rows(LEARNING);
  const sum = (rs: SubscriptionRow[]) => rs.reduce((s, r) => s + r.monthly, 0);
  const monthly = sum(subs);
  return {
    subscriptions: subs,
    learning,
    monthly,
    learningMonthly: sum(learning),
    shareOfPay: lastPayPence && lastPayPence > 0 ? Math.round((monthly * 100) / lastPayPence) : null,
    others: active.filter((b) => b.category !== SUBSCRIPTIONS && b.category !== LEARNING),
  };
}
