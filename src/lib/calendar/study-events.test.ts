import { test } from "node:test";
import assert from "node:assert/strict";
import { isEditable, isUnanswered, readTag, selfResponse, studyTag } from "./study-events.ts";

test("readTag tells life blocks, study slots and sessions apart", () => {
  assert.deepEqual(readTag({ portalKind: "gym" }), { type: "life", kind: "gym" });
  assert.deepEqual(readTag(studyTag("92", "session", "pmpp")), { type: "study", task: "92", role: "session", project: "pmpp" });
  assert.deepEqual(readTag(studyTag("92", "slot", null)), { type: "study", task: "92", role: "slot", project: null });
  assert.equal(readTag(undefined), null);
  assert.equal(readTag({}), null);
  assert.equal(readTag({ portalTask: "x1", portalRole: "session" }), null);
  assert.equal(readTag({ portalTask: "92", portalRole: "other" }), null);
});

test("only life blocks and sessions can be edited, never a mirrored slot", () => {
  assert.equal(isEditable({ type: "life", kind: "lunch" }), true);
  assert.equal(isEditable({ type: "study", task: "1", role: "session", project: null }), true);
  assert.equal(isEditable({ type: "study", task: "1", role: "slot", project: null }), false);
  assert.equal(isEditable(null), false);
});

test("selfResponse reads the owner's answer to an invite", () => {
  assert.equal(selfResponse(undefined), null);
  assert.equal(selfResponse([{ responseStatus: "accepted" }]), null);
  assert.equal(selfResponse([{ self: true, responseStatus: "accepted" }, { responseStatus: "declined" }]), "accepted");
  assert.equal(selfResponse([{ self: true, responseStatus: "tentative" }]), "tentative");
  assert.equal(selfResponse([{ self: true, responseStatus: "declined" }]), "declined");
  assert.equal(selfResponse([{ self: true, responseStatus: "needsAction" }]), "needsAction");
  assert.equal(selfResponse([{ self: true }]), "needsAction");
});

test("unanswered and declined invites are hidden, accepted and maybe are kept", () => {
  assert.equal(isUnanswered("needsAction"), true);
  assert.equal(isUnanswered("declined"), true);
  assert.equal(isUnanswered("accepted"), false);
  assert.equal(isUnanswered("tentative"), false);
  assert.equal(isUnanswered(null), false);
});
