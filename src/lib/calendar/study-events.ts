// Study time in Google Calendar. A task's own time slot is mirrored there, and
// extra study sessions for a task live there, so the whole plan shows up in
// Google Calendar next to life blocks. Each event carries private properties
// that say which task it belongs to. Pure, so it is tested.

import { isLifeKind, type LifeKind } from "./life-blocks.ts";

/** Blueberry, so study stands apart from the life colours. */
export const STUDY_COLOR = "9";

/**
 * slot: the mirror of a task's own start and due time. The task is the source
 * of truth, so the portal rewrites this event and it is never edited directly.
 * session: one more block of time on the task, kept only in Google Calendar.
 */
export type StudyRole = "slot" | "session";

export type PortalTag =
  { type: "life"; kind: LifeKind } | { type: "study"; task: string; role: StudyRole; project: string | null } | null;

/** What the portal wrote on an event, or null for events made elsewhere. */
export function readTag(props: Record<string, string> | undefined): PortalTag {
  if (!props) return null;
  if (isLifeKind(props.portalKind)) return { type: "life", kind: props.portalKind };
  const task = props.portalTask;
  const role = props.portalRole;
  if (task && /^\d{1,30}$/.test(task) && (role === "slot" || role === "session")) {
    return { type: "study", task, role, project: props.portalProject || null };
  }
  return null;
}

export function studyTag(task: string, role: StudyRole, project: string | null): Record<string, string> {
  return { portalTask: task, portalRole: role, ...(project ? { portalProject: project } : {}) };
}

/** Events the portal may move or delete: life blocks and study sessions, never a task's mirrored slot. */
export function isEditable(tag: PortalTag): boolean {
  return tag !== null && (tag.type === "life" || tag.role === "session");
}

export type InviteResponse = "accepted" | "tentative" | "needsAction" | "declined";

/** How the calendar's owner answered an invite. Null for events with no guests, which are their own. */
export function selfResponse(
  attendees: { self?: boolean; responseStatus?: string }[] | undefined,
): InviteResponse | null {
  const me = attendees?.find((a) => a.self);
  if (!me) return null;
  const r = me.responseStatus;
  return r === "accepted" || r === "tentative" || r === "declined" ? r : "needsAction";
}

/** Invites not said yes or maybe to. These stay off the schedule unless asked for. */
export function isUnanswered(response: InviteResponse | null): boolean {
  return response === "needsAction" || response === "declined";
}
