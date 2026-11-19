// Which roles are in progress, and which of those have no plan.
//
// A role only reaches Today when it has both a next action and a date. One that
// was moved to Applied or Interviewing without them dropped out of sight: Today
// said nothing and the hub said "Nothing due". That is where a search slips, so
// the portal notices it. Planning and monitoring the search, not its volume, is
// what predicts a good job (van Hooft et al., Journal of Applied Psychology, 2021),
// and a dated next step is the cue that gets an intention acted on (Gollwitzer and
// Sheeran, 2006). Pure, so it is tested.

type Tracked = {
  stage: string;
  closed_at: string | null;
  next_action: string;
  next_action_on: string | null;
};

/** The stages of a role in progress, furthest along first. */
export const LIVE_STAGES = ["offer", "interview", "applied", "saved"];

/**
 * In progress: applied for or beyond, or saved while its advert is still listed.
 * A saved role whose advert has gone is over; an application outlives its advert.
 */
export function isLive(role: Pick<Tracked, "stage" | "closed_at">): boolean {
  return LIVE_STAGES.includes(role.stage) && !(role.stage === "saved" && role.closed_at !== null);
}

/**
 * The roles in progress that nothing will bring back to mind: no next action, or
 * no date for it. Furthest along first, since those cost most to let slip.
 */
export function needsNextStep<T extends Tracked>(roles: T[]): T[] {
  return roles
    .filter((r) => isLive(r) && (r.next_action.trim() === "" || !r.next_action_on))
    .sort((a, b) => LIVE_STAGES.indexOf(a.stage) - LIVE_STAGES.indexOf(b.stage));
}
