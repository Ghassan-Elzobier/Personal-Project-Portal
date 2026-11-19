import { test } from "node:test";
import assert from "node:assert/strict";
import { isLive, needsNextStep } from "./next-step.ts";

// Made-up roles: the repository is public.
const role = (name: string, stage: string, plan: { action?: string; on?: string | null; closed?: boolean } = {}) => ({
  name,
  stage,
  closed_at: plan.closed ? "2026-11-10T09:00:00Z" : null,
  next_action: plan.action ?? "",
  next_action_on: plan.on ?? null,
});
const names = (roles: { name: string }[]) => roles.map((r) => r.name);

test("an application with no next action, or no date for it, needs a next step", () => {
  const roles = [
    role("no action", "applied"),
    role("action, no date", "applied", { action: "Follow up with Example Ltd" }),
    role("date, no action", "applied", { on: "2026-11-20" }),
    role("only spaces", "applied", { action: "   ", on: "2026-11-20" }),
    role("planned", "applied", { action: "Follow up with Example Ltd", on: "2026-11-20" }),
  ];
  assert.deepEqual(names(needsNextStep(roles)), ["no action", "action, no date", "date, no action", "only spaces"]);
});

test("every stage in progress counts, and a role that is over or not started does not", () => {
  const roles = [
    role("saved", "saved"),
    role("applied", "applied"),
    role("interview", "interview"),
    role("offer", "offer"),
    role("new", "new"),
    role("rejected", "rejected"),
    role("passed", "passed"),
  ];
  assert.deepEqual(names(needsNextStep(roles)).sort(), ["applied", "interview", "offer", "saved"]);
});

test("a saved role whose advert has gone is over, but an application outlives its advert", () => {
  assert.equal(isLive(role("saved, listed", "saved")), true);
  assert.equal(isLive(role("saved, gone", "saved", { closed: true })), false);
  assert.equal(isLive(role("applied, gone", "applied", { closed: true })), true);
  assert.equal(isLive(role("interview, gone", "interview", { closed: true })), true);
  assert.deepEqual(
    names(
      needsNextStep([
        role("saved, gone", "saved", { closed: true }),
        role("applied, gone", "applied", { closed: true }),
      ]),
    ),
    ["applied, gone"],
  );
});

test("the furthest along come first, since those cost most to let slip", () => {
  const roles = [
    role("a saved", "saved"),
    role("b applied", "applied"),
    role("c offer", "offer"),
    role("d interview", "interview"),
  ];
  assert.deepEqual(names(needsNextStep(roles)), ["c offer", "d interview", "b applied", "a saved"]);
});

test("a dated next action takes a role off the list, and nothing in progress leaves it empty", () => {
  const applied = role("applied", "applied");
  assert.equal(needsNextStep([applied]).length, 1);
  assert.equal(
    needsNextStep([{ ...applied, next_action: "Send the portfolio link", next_action_on: "2026-11-23" }]).length,
    0,
  );
  assert.deepEqual(needsNextStep([]), []);
});
