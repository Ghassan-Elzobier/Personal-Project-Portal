import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksHref } from "./tasks-href.ts";

// The Tasks page's own links. Each one names the view it goes to; none may
// borrow it from the view you are on, or a switch back to List keeps the board.

test("tasksHref leaves the view out for the list, which is the default", () => {
  assert.equal(tasksHref({ project: "pmpp", view: "list" }), "/tasks?project=pmpp");
});

test("tasksHref names the board", () => {
  assert.equal(tasksHref({ project: "pmpp", view: "board" }), "/tasks?project=pmpp&view=board");
});

test("tasksHref keeps an open task in the link", () => {
  assert.equal(tasksHref({ project: "axler", view: "board", task: "12" }), "/tasks?project=axler&view=board&task=12");
  assert.equal(tasksHref({ project: "axler", view: "list", task: "12" }), "/tasks?project=axler&task=12");
});
