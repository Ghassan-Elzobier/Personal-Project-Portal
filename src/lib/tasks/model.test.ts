import { test } from "node:test";
import assert from "node:assert/strict";
import { completionChange, enumOption, field, filterNativeRows, groupBySection, nativeChanges, nativeToAsanaTask, projectStats, stageChange, type NativeTaskRow } from "./model.ts";

const row: NativeTaskRow = {
  gid: "7",
  project: "axler",
  section_gid: "3",
  section_name: "To do",
  name: "Chapter 3",
  notes: "",
  resource_subtype: "default_task",
  completed: false,
  completed_at: null,
  start_on: null,
  due_on: "2026-11-10",
  start_at: null,
  due_at: null,
  stage: "In progress",
  hours: "3.50",
  evidence: "https://example.com/notes",
  modified_at: "2026-11-04T10:00:00Z",
};

test("a native row reads like an Asana task through field and enumOption", () => {
  const task = nativeToAsanaTask(row, "/tasks?task=7");
  assert.equal(field(task, "Hours")?.number_value, 3.5);
  assert.equal(field(task, "evidence")?.text_value, "https://example.com/notes");
  assert.equal(field(task, "Stage")?.enum_value?.name, "In progress");
  assert.equal(enumOption(field(task, "Stage"), "done")?.gid, "Done");
  assert.deepEqual(task.memberships, [{ project: { gid: "axler" }, section: { gid: "3", name: "To do" } }]);
});

test("a native row with no section has no section membership", () => {
  const task = nativeToAsanaTask({ ...row, section_gid: null, section_name: null }, "/x");
  assert.equal(task.memberships?.[0].section, null);
});

test("nativeChanges flattens custom fields into columns and keeps cleared values", () => {
  assert.deepEqual(nativeChanges({ custom_fields: { hours: 4, stage: "Done" }, completed: true, start_at: null }), {
    hours: 4,
    stage: "Done",
    completed: true,
    start_at: null,
  });
});

test("stage and completion stay in step", () => {
  assert.deepEqual(stageChange("Done"), { stage: "Done", completed: true });
  assert.deepEqual(stageChange("Blocked"), { stage: "Blocked", completed: false });
  assert.deepEqual(completionChange(true, "Blocked"), { completed: true, stage: "Done" });
  assert.deepEqual(completionChange(false, "Done"), { completed: false, stage: "In progress" });
  assert.deepEqual(completionChange(false, "Blocked"), { completed: false });
});

test("projectStats counts open, overdue and hours, and never counts a finished task as overdue", () => {
  const stats = projectStats(
    [
      { completed: false, dueOn: "2026-11-01", hours: 1.5, stage: "In progress" },
      { completed: true, dueOn: "2026-11-01", hours: 2, stage: "Done" },
      { completed: false, dueOn: "2026-11-04", hours: 0, stage: null },
      { completed: false, dueOn: null, hours: 0, stage: "Blocked" },
    ],
    "2026-11-04",
  );
  assert.equal(stats.total, 4);
  assert.equal(stats.open, 3);
  assert.equal(stats.done, 1);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.hours, 3.5);
  assert.equal(stats.percent, 25);
  assert.deepEqual(stats.stages, [
    { stage: "Not started", count: 1 },
    { stage: "In progress", count: 1 },
    { stage: "Blocked", count: 1 },
    { stage: "Done", count: 1 },
  ]);
});

test("projectStats handles an empty project", () => {
  const stats = projectStats([], "2026-11-04");
  assert.equal(stats.percent, 0);
  assert.deepEqual(stats.stages, []);
});

test("groupBySection keeps empty sections and puts loose tasks last", () => {
  const sections = [{ gid: "1", name: "To do" }, { gid: "2", name: "Later" }];
  const tasks = [{ sectionGid: "2" }, { sectionGid: null }, { sectionGid: "99" }];
  const groups = groupBySection(sections, tasks);
  assert.deepEqual(groups.map((g) => [g.name, g.tasks.length]), [["To do", 0], ["Later", 1], ["No section", 2]]);
  assert.equal(groups[2].gid, null);
});

test("groupBySection adds no empty No section group", () => {
  assert.deepEqual(groupBySection([{ gid: "1", name: "To do" }], []).map((g) => g.name), ["To do"]);
});

test("filterNativeRows keeps open tasks and those finished or changed since a moment", () => {
  const open = { ...row, gid: "1", modified_at: "2026-11-01T00:00:00Z" };
  const doneOld = { ...row, gid: "2", completed: true, completed_at: "2026-10-01T00:00:00Z", modified_at: "2026-10-01T00:00:00Z" };
  const doneNew = { ...row, gid: "3", completed: true, completed_at: "2026-11-03T00:00:00Z", modified_at: "2026-11-03T00:00:00Z" };
  const rows = [open, doneOld, doneNew];
  const gids = (r: NativeTaskRow[]) => r.map((x) => x.gid);
  assert.deepEqual(gids(filterNativeRows(rows, {})), ["1", "2", "3"]);
  assert.deepEqual(gids(filterNativeRows(rows, { completedSince: new Date("2026-11-02T00:00:00Z") })), ["1", "3"]);
  assert.deepEqual(gids(filterNativeRows(rows, { modifiedSince: new Date("2026-11-02T00:00:00Z") })), ["3"]);
});
