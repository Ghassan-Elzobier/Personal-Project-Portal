import { expect, test } from "@playwright/test";
import { checkArgs, unsupported } from "../src/lib/mcp/tool.ts";
import { connectClaude } from "./connector";

// Claude's tools, called the way Claude calls them: through the connector, with a
// token from the consent page. Connecting shows on the Claude page, so this runs
// with the save tests and disconnects before it ends.

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

test("every tool says what it takes in words the checker knows, and a tool with nothing required takes an empty call", async ({
  page,
  request,
}) => {
  const claude = await connectClaude(page, request);
  try {
    const tools = await claude.tools();
    expect(tools.length).toBeGreaterThan(30);
    for (const tool of tools) {
      expect(unsupported(tool.inputSchema), `${tool.name} uses only keywords that are checked`).toEqual([]);
      const required = tool.inputSchema.required;
      if (!Array.isArray(required) || required.length === 0)
        expect(checkArgs(tool.inputSchema, {}), `${tool.name} takes an empty call`).toBeNull();
      else expect(checkArgs(tool.inputSchema, {}), `${tool.name} asks for what it needs`).toContain("is required");
    }
  } finally {
    await claude.disconnect();
  }
});

test("a call with a missing, out-of-range or unknown value comes back as an error that says what to fix, and a good call still runs", async ({
  page,
  request,
}) => {
  const claude = await connectClaude(page, request);
  try {
    const missing = await claude.call("money_afford", {});
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe("pence is required: a whole number from 1 to 10000000.");

    const text = await claude.call("money_afford", { pence: "1200" });
    expect(text.isError).toBe(true);
    expect(text.text).toBe('pence must be a whole number from 1 to 10000000, not the text "1200".');

    const short = await claude.call("schedule_task", { task_gid: "1", date: "2026-11-16", start: "10:00", minutes: 5 });
    expect(short.isError).toBe(true);
    expect(short.text).toMatch(/^minutes must be a whole number from 15 to 720, not 5\./);

    const day = await claude.call("get_life_day", { date: "next Tuesday" });
    expect(day.isError).toBe(true);
    expect(day.text).toMatch(/^date must be text matching .*, not the text "next Tuesday"\. \(Day, YYYY-MM-DD\.\)$/);

    const stray = await claude.call("get_today", { verbose: true });
    expect(stray.isError).toBe(true);
    expect(stray.text).toBe("verbose is not something this tool takes. It takes nothing.");

    // A null is a field left out, and a call that fits runs as before.
    const today = await claude.call("get_life_day", { date: null });
    expect(today.isError, today.text).toBe(false);
    const start = await claude.call("get_today");
    expect(start.isError, start.text).toBe(false);
    expect(JSON.parse(start.text)).toMatchObject({ today: "2026-11-16", weekday: "Monday" });
  } finally {
    await claude.disconnect();
  }
});
