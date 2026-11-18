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
    buffer: text(input?.buffer),
    bufferFrom: text(input?.bufferFrom),
    firstPayday: text(input?.firstPayday),
    paydayRule: text(input?.paydayRule),
  });
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
