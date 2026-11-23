"use server";

import { requireOwner } from "@/lib/auth/access";
import * as ops from "@/lib/money/operations";

// The Money page's buttons. Each checks for the owner, then runs the shared operation.

export async function bankAccounts() {
  await requireOwner();
  return ops.accountsToPick();
}

export async function connectBank(uids: string[]) {
  await requireOwner();
  const ids = Array.isArray(uids) ? uids.filter((u): u is string => typeof u === "string").slice(0, 10) : [];
  return ops.connectAccounts(ids);
}

export async function refreshBank() {
  await requireOwner();
  return ops.refreshBank();
}

export async function disconnectBank() {
  await requireOwner();
  return ops.disconnectBank();
}

export async function forgetBank() {
  await requireOwner();
  return ops.forgetBank();
}

export async function registerSyncKey() {
  await requireOwner();
  return ops.registerSyncKey();
}

export async function setCategory(txn: number, category: number | null, always: boolean) {
  await requireOwner();
  if (!Number.isInteger(txn) || (category !== null && !Number.isInteger(category)))
    return { error: "Pick a category." };
  return ops.setCategory(txn, category, always === true);
}

export async function saveSettings(input: ops.SettingsInput) {
  await requireOwner();
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : "");
  return ops.saveSettings({
    allowance: text(input?.allowance),
    floor: text(input?.floor),
    buffer: text(input?.buffer),
    bufferFrom: text(input?.bufferFrom),
    firstPayday: text(input?.firstPayday),
    paydayRule: text(input?.paydayRule),
  });
}

export async function savePlanned(input: ops.PlannedInput) {
  await requireOwner();
  const text = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return ops.savePlanned({
    name: text(input?.name, 60),
    amount: text(input?.amount, 20),
    dueOn: text(input?.dueOn, 10),
    funding: text(input?.funding, 20),
    weeks: typeof input?.weeks === "number" ? input.weeks : 1,
  });
}

/** "Can I afford it?" for a cost typed in the purchase form. Reads only. */
export async function checkAfford(amount: string) {
  await requireOwner();
  return ops.checkAfford(typeof amount === "string" ? amount.slice(0, 20) : "");
}

export async function cancelPlanned(id: number) {
  await requireOwner();
  return ops.cancelPlanned(id);
}

export async function saveIncome(input: ops.PayInput) {
  await requireOwner();
  return ops.saveIncome({
    fromOn: String(input?.fromOn ?? ""),
    takeHome: String(input?.takeHome ?? ""),
    gross: String(input?.gross ?? ""),
    loans: Array.isArray(input?.loans) ? input.loans.slice(0, 5) : [],
    pensionPercent: Number(input?.pensionPercent) || 0,
    pensionKind: ["salary-sacrifice", "net-pay", "relief-at-source"].includes(input?.pensionKind)
      ? input.pensionKind
      : "net-pay",
  });
}

export async function removeIncome(id: number) {
  await requireOwner();
  return ops.removeIncome(Number(id));
}

export async function saveGoal(input: ops.GoalInput) {
  await requireOwner();
  const kind = (["saving", "sinking", "debt"] as const).find((k) => k === input?.kind) ?? "saving";
  return ops.saveGoal({
    name: String(input?.name ?? ""),
    kind,
    amount: String(input?.amount ?? ""),
    dueOn: String(input?.dueOn ?? ""),
    repeatsYearly: input?.repeatsYearly === true,
    held: input?.held === "elsewhere" ? "elsewhere" : "account",
    saved: String(input?.saved ?? ""),
    apr: String(input?.apr ?? ""),
    payment: String(input?.payment ?? ""),
  });
}

export async function removeGoal(id: number) {
  await requireOwner();
  return ops.removeGoal(Number(id));
}

export async function moveGoal(id: number, step: number) {
  await requireOwner();
  return ops.moveGoal(Number(id), Number(step) < 0 ? -1 : 1);
}

export async function addSuggestedGoals() {
  await requireOwner();
  return ops.addSuggestedGoals();
}

export async function setBill(id: number, status: "active" | "ignored") {
  await requireOwner();
  return ops.setBill(Number(id), status === "ignored" ? "ignored" : "active");
}

export async function setCategoryBudget(key: string, amount: string) {
  await requireOwner();
  if (typeof key !== "string" || typeof amount !== "string") return { error: "Say the amount in pounds." };
  return ops.setCategoryBudget(key.slice(0, 40), amount.slice(0, 20));
}

export async function dismissAlert(id: number) {
  await requireOwner();
  return ops.dismissAlert(id);
}

export async function setClaudeAccess(level: string) {
  await requireOwner();
  if (level !== "off" && level !== "summary" && level !== "plan" && level !== "setup")
    return { error: "Pick a level." };
  return ops.setClaudeAccess(level);
}

export async function uploadStatement(account: number, text: string) {
  await requireOwner();
  if (!Number.isInteger(account) || typeof text !== "string") return { error: "Pick an account and a file." };
  return ops.uploadStatement(account, text);
}
