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
