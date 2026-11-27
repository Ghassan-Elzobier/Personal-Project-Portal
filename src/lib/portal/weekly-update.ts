import "server-only";
import { askClaude, claudeReady } from "../ai/claude";
import { AiError, type AiCode } from "../ai/messages";
import { isProjectKey, projectDef } from "../config/projects";
import { AsanaError } from "../tasks/tracker";
import { polishAsk, readPolish, withDone } from "../tasks/weekly-polish";
import { weekSummary } from "./data";

// Claude's write-up of a Sunday update's "Done this week:" line (/week). It changes
// nothing and posts nothing: the text goes back into the owner's form. Posting stays
// postStatusUpdate in ./operations.ts, which the owner's own tap calls.

export type PolishResult = { text?: string; error?: string };

/** Why Claude wrote nothing up, in the owner's words. The draft in the form stays as it was. */
function polishProblem(code: AiCode): string {
  switch (code) {
    case "NO_KEY":
      return "Claude isn't set up for the portal (ANTHROPIC_API_KEY).";
    case "BAD_KEY":
      return "The Claude API refused the portal's key. Check ANTHROPIC_API_KEY in Vercel.";
    case "NO_CREDIT":
      return "This month's Claude API credit is spent. It renews with the plan; the draft is as it was.";
    case "RATE_LIMITED":
    case "OVERLOADED":
      return "Claude is busy just now. Try again in a minute.";
    case "TIMEOUT":
    case "NETWORK":
      return "Claude didn't answer in time. Try again.";
    default:
      return "Claude couldn't write this week up. The draft is as it was.";
  }
}

/**
 * Claude writes the "Done this week:" line of a project's Sunday update from this week's
 * session notes (src/lib/tasks/weekly-polish.ts), into the text the owner has in the form.
 */
export async function polishWeeklyUpdate(project: string, text: string): Promise<PolishResult> {
  if (!isProjectKey(project)) return { error: "Unknown project." };
  if (!claudeReady()) return { error: polishProblem("NO_KEY") };
  const update = text.replace(/\r\n?/g, "\n");
  if (!/^\s*Done this week:/im.test(update))
    return { error: "Put back the line that starts “Done this week:”, and Claude fills it in." };
  try {
    const week = await weekSummary(project);
    if (!week.sessions.length)
      return { error: "No session this week has notes for Claude to write from. Add notes when you log one." };
    const done = readPolish(
      await askClaude(
        polishAsk({
          project: projectDef(project).title,
          finished: week.done.map((t) => t.name),
          sessions: week.sessions,
        }),
      ),
    );
    if (!done)
      return { error: "Claude found nothing in this week's notes to add to the list, so the draft is as it was." };
    return { text: withDone(update, done) ?? update };
  } catch (err) {
    if (err instanceof AiError) return { error: polishProblem(err.code) };
    if (err instanceof AsanaError) return { error: err.message };
    console.error(err);
    return { error: "Could not write up the week. The draft is as it was." };
  }
}
