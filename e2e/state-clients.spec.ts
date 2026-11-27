import { expect, test, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Client projects: a client, their project and its milestones, added on the
// Clients page or by Claude, show at once and after a reload; the stage moves, a
// milestone is accepted and paid, and the money adds up. They are the owner's
// alone: none of it ever shows among the tasks or on the pages mentors read.
// Each test deletes the client it made, which takes its projects and milestones.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** A project's card on the Clients page, found by its title. */
const card = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** Deletes a client through the Clients page, if it is there. */
async function deleteOnPage(page: Page, name: string) {
  await page.goto("/clients");
  const remove = page.getByRole("button", { name: `Delete client ${name}`, exact: true });
  if ((await remove.count()) === 0) return;
  page.once("dialog", (dialog) => void dialog.accept());
  await remove.click();
  await expect(page.getByRole("region", { name, exact: true })).toHaveCount(0);
}

test("a client, project and milestone added on the Clients page show at once and after a reload, move on, get paid and delete", async ({
  page,
}) => {
  const client = unique("Example Client");
  const project = unique("Example glossary");
  const milestone = "Example first version";
  try {
    await page.goto("/clients");
    await page.getByLabel("Client name").fill(client);
    await page.getByLabel("How you know them").selectOption("family");
    await page.getByLabel("Where you talk").fill("WhatsApp");
    await page.getByRole("button", { name: "Add client", exact: true }).click();
    await expect(page.getByLabel("Client name")).toHaveValue("");
    const region = page.getByRole("region", { name: client, exact: true });
    await expect(region.getByText("Family · WhatsApp", { exact: true })).toBeVisible();
    await page.reload();
    await expect(region.getByText("Family · WhatsApp", { exact: true })).toBeVisible();

    // A project for that client starts as a lead, at a fixed price.
    await region.getByLabel(`New project for ${client}`).fill(project);
    await region.getByRole("button", { name: "Add project", exact: true }).click();
    await expect(region.getByRole("heading", { name: project, exact: true })).toBeVisible();
    const stage = page.getByLabel(`Stage of ${project}`);
    await expect(stage).toHaveValue("lead");
    await expect(card(page, project).getByText("Fixed price", { exact: true })).toBeVisible();

    // The stage moves in one pick, and stays moved.
    await stage.selectOption("building");
    await expect(stage).toHaveValue("building");
    await page.reload();
    await expect(page.getByLabel(`Stage of ${project}`)).toHaveValue("building");

    // A milestone with a day and an amount in pounds.
    await page.getByLabel(`New milestone for ${project}`).fill(milestone);
    await page.getByLabel(`Due day of the new milestone for ${project}`).fill("2026-12-18");
    await page.getByLabel(`Amount in pounds of the new milestone for ${project}`).fill("1,500");
    await card(page, project).getByRole("button", { name: "Add milestone", exact: true }).click();
    const milestones = page.getByRole("list", { name: `Milestones of ${project}` });
    await expect(milestones.getByText(milestone, { exact: true })).toBeVisible();
    await expect(milestones.getByText("£1,500.00", { exact: true })).toBeVisible();
    await expect(milestones.getByText("Due 18 Dec", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: `Milestones of ${project}` }).getByText(milestone)).toBeVisible();

    // The page holds at 360 px with no sideways scroll.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole("button", { name: `Accepted: ${milestone}` })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      "no sideways scroll at 360 px",
    ).toBe(true);
    await page.setViewportSize({ width: 412, height: 915 });

    // Accepted by the client: it is owed until it is paid.
    const accepted = page.getByRole("button", { name: `Accepted: ${milestone}` });
    await accepted.click();
    await expect(accepted).toHaveAttribute("aria-pressed", "true");
    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance.getByText("£1,500.00", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: `Accepted: ${milestone}` })).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, project).getByText("· £1,500.00 owed")).toBeVisible();

    // Paid: nothing is owed any more.
    const paid = page.getByRole("button", { name: `Paid: ${milestone}` });
    await paid.click();
    await expect(paid).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: `Paid: ${milestone}` })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "At a glance" }).getByText("£0.00", { exact: true })).toBeVisible();

    // Deleted, the client goes with everything under it, after a reload too.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: `Delete client ${client}`, exact: true }).click();
    await expect(page.getByRole("region", { name: client, exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(project)).toHaveCount(0);
  } finally {
    await deleteOnPage(page, client);
  }
});

test("a client project from Claude shows on the Clients page, never among the tasks, and Claude moves it on and deletes it", async ({
  page,
  request,
}) => {
  const client = unique("Example Client from Claude");
  const project = unique("Example app from Claude");
  const claude = await connectClaude(page, request);
  let gid: string | null = null;
  try {
    const tools = await claude.tools();
    const annotations = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(annotations("list_client_projects")).toMatchObject({ readOnlyHint: true });
    expect(annotations("add_client")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations("update_client_milestone")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations("remove_client_record")).toMatchObject({ destructiveHint: true });

    const added = await claude.call("add_client", { name: client, relationship: "referral" });
    expect(added.isError, added.text).toBe(false);
    gid = (JSON.parse(added.text) as { added: { client_gid: string } }).added.client_gid;

    const madeProject = await claude.call("add_client_project", { client_gid: gid, title: project });
    expect(madeProject.isError, madeProject.text).toBe(false);
    const made = (JSON.parse(madeProject.text) as { added: { project_gid: string; stage: string } }).added;
    expect(made.stage).toBe("lead");

    const madeMilestone = await claude.call("add_client_milestone", {
      project_gid: made.project_gid,
      title: "Example handover",
      due_on: "2026-12-18",
      amount_pence: 250_000,
    });
    expect(madeMilestone.isError, madeMilestone.text).toBe(false);

    const moved = await claude.call("update_client_project", {
      project_gid: made.project_gid,
      stage: "building",
      repo_url: "https://example.test/repo",
    });
    expect(moved.isError, moved.text).toBe(false);
    expect((JSON.parse(moved.text) as { saved: { stage: string } }).saved.stage).toBe("building");
    const refused = await claude.call("update_client_project", { project_gid: made.project_gid, live_url: "http://x" });
    expect(refused.isError, "an http link is refused").toBe(true);

    const list = await claude.call("list_client_projects");
    expect(list.isError, list.text).toBe(false);
    const listed = (
      JSON.parse(list.text) as {
        clients: {
          client_gid: string;
          projects: { title: string; next_milestone: { title: string } | null; money: { agreed_pence: number } }[];
        }[];
      }
    ).clients.find((c) => c.client_gid === gid);
    expect(listed?.projects[0]).toMatchObject({
      title: project,
      next_milestone: { title: "Example handover" },
      money: { agreed_pence: 250_000 },
    });

    await page.goto("/clients");
    await expect(page.getByRole("region", { name: client, exact: true })).toBeVisible();
    await expect(page.getByLabel(`Stage of ${project}`)).toHaveValue("building");
    await expect(card(page, project).getByRole("link", { name: "Repo", exact: true })).toHaveAttribute(
      "href",
      "https://example.test/repo",
    );

    // Never a task, so never on the pages that show tasks to the owner or to mentors.
    for (const path of ["/tasks", "/week", "/timeline", "/progress"]) {
      await page.goto(path);
      await expect(page.getByText(project), path).toHaveCount(0);
    }

    const removed = await claude.call("remove_client_record", { kind: "client", gid });
    expect(removed.isError, removed.text).toBe(false);
    const after = await claude.call("list_client_projects");
    expect(after.text).not.toContain(client);
    const again = await claude.call("remove_client_record", { kind: "client", gid });
    expect(again.isError).toBe(true);
    gid = null;
  } finally {
    if (gid) await claude.call("remove_client_record", { kind: "client", gid });
    await claude.disconnect();
  }
});
