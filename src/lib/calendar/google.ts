import "server-only";
import { cache } from "react";
import { timeZone } from "../config/env";
import { LIFE_KINDS, recurrence, wallClock, type LifeKind, type Repeat } from "./life-blocks";
import { isEditable, readTag, selfResponse, STUDY_COLOR, studyTag, type InviteResponse, type StudyRole } from "./study-events";
import { connectorCaller } from "../connector/context";
import { createClient } from "../supabase/server";
import { decryptToken } from "./token-crypto";

// Google Calendar for life blocks and study time. The OAuth client secret and the token key
// are server-side env vars; the refresh token is stored encrypted through the
// owner-only RPCs. Only the calendar.events scope is requested.

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";

// The bases can point at a fake Google under `next dev` for local testing.
// They are ignored in production builds.
const dev = process.env.NODE_ENV !== "production";
const TOKEN_URL = (dev && process.env.GOOGLE_TOKEN_URL) || "https://oauth2.googleapis.com/token";
const AUTH_URL = (dev && process.env.GOOGLE_AUTH_URL) || "https://accounts.google.com/o/oauth2/v2/auth";
const API = (dev && process.env.GOOGLE_API_BASE) || "https://www.googleapis.com/calendar/v3";

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_KEY);
}

export function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
}

export function authUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    if (detail.error === "invalid_grant") {
      throw new GoogleError("Google access was revoked or expired. Reconnect Google Calendar.", 401);
    }
    throw new GoogleError(`Google sign-in failed (${res.status}).`, res.status);
  }
  return res.json();
}

export async function exchangeCode(code: string, redirectUri: string) {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  // The id_token came straight from Google over TLS, so its payload is read
  // without verifying the signature; it is only used to show which account.
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      email = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()).email ?? null;
    } catch {
      email = null;
    }
  }
  return { refreshToken: tokens.refresh_token ?? null, email };
}

export type GoogleConnection = { email: string | null; connectedAt: string };

/** The stored connection, without the token. Null when not connected. */
export const googleConnection = cache(async (): Promise<(GoogleConnection & { sealed: string }) | null> => {
  // A Claude connector call has no cookies; its token lookup brought the connection.
  const caller = connectorCaller();
  if (caller) return caller.google;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("google_connection");
  if (error) return null;
  const row = (data as { refresh_token: string; google_email: string | null; connected_at: string }[] | null)?.[0];
  return row ? { sealed: row.refresh_token, email: row.google_email, connectedAt: row.connected_at } : null;
});

// Access tokens last about an hour, so keep one rather than asking Google on
// every request. Keyed by the sealed token, so a reconnect starts afresh.
let heldToken: { sealed: string; token: string; expiresAt: number } | null = null;

/** A live access token for the stored connection. */
const accessToken = cache(async (): Promise<string> => {
  const connection = await googleConnection();
  if (!connection) throw new GoogleError("Google Calendar is not connected.", 412);
  if (heldToken && heldToken.sealed === connection.sealed && heldToken.expiresAt > Date.now()) return heldToken.token;
  const refreshToken = decryptToken(connection.sealed, process.env.GOOGLE_TOKEN_KEY);
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  const lifetime = (fresh.expires_in ?? 3600) - 120;
  heldToken = { sealed: connection.sealed, token: fresh.access_token, expiresAt: Date.now() + lifetime * 1000 };
  return fresh.access_token;
});

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleError(`Google Calendar: ${detail.error?.message ?? res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

type GoogleEvent = {
  id: string;
  summary?: string;
  status: string;
  htmlLink: string;
  recurringEventId?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type CalendarEvent = {
  id: string;
  seriesId: string | null;
  title: string;
  start: string;
  end: string;
  url: string;
  /** Set for life blocks the portal created; others are shown read-only. */
  kind: LifeKind | null;
  /** Set for study time the portal put in the calendar. */
  study: { task: string; role: StudyRole; project: string | null } | null;
  /** The owner's answer when this is someone else's invite. */
  response: InviteResponse | null;
};

const cal = () => `/calendars/${encodeURIComponent(calendarId())}`;

/** Timed events between two instants, recurring ones expanded. All-day events are skipped. */
export async function listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const body = await api<{ items: GoogleEvent[]; nextPageToken?: string }>(`${cal()}/events?${params}`);
    for (const e of body.items) {
      if (e.status === "cancelled" || !e.start.dateTime || !e.end.dateTime) continue;
      const tag = readTag(e.extendedProperties?.private);
      events.push({
        id: e.id,
        seriesId: e.recurringEventId ?? null,
        title: e.summary ?? "Busy",
        start: e.start.dateTime,
        end: e.end.dateTime,
        url: e.htmlLink,
        kind: tag?.type === "life" ? tag.kind : null,
        study: tag?.type === "study" ? { task: tag.task, role: tag.role, project: tag.project } : null,
        response: selfResponse(e.attendees),
      });
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

export async function createLifeBlock(input: {
  kind: LifeKind;
  title: string;
  date: string;
  start: number;
  duration: number;
  repeat: Repeat;
  weekday: number;
}): Promise<void> {
  const tz = timeZone();
  await api(`${cal()}/events`, {
    method: "POST",
    body: {
      summary: input.title || LIFE_KINDS[input.kind].label,
      start: { dateTime: wallClock(input.date, input.start), timeZone: tz },
      end: { dateTime: wallClock(input.date, input.start + input.duration), timeZone: tz },
      recurrence: recurrence(input.repeat, input.weekday),
      colorId: LIFE_KINDS[input.kind].googleColor,
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { portalKind: input.kind } },
    },
  });
}

type StudyTask = { gid: string; name: string; project: string | null };

/** The events holding a task's mirrored slot. Normally one; more only after a race. */
async function slotEvents(gid: string): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({ maxResults: "10" });
  params.append("privateExtendedProperty", `portalTask=${gid}`);
  params.append("privateExtendedProperty", "portalRole=slot");
  const body = await api<{ items: GoogleEvent[] }>(`${cal()}/events?${params}`);
  return body.items.filter((e) => e.status !== "cancelled");
}

/** Writes a task's time slot to the calendar, replacing what was there for it. */
export async function upsertTaskSlot(task: StudyTask, start: Date, end: Date): Promise<void> {
  const tz = timeZone();
  const body = {
    summary: task.name,
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    colorId: STUDY_COLOR,
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: studyTag(task.gid, "slot", task.project) },
  };
  const [first, ...extra] = await slotEvents(task.gid);
  if (first) await api(`${cal()}/events/${encodeURIComponent(first.id)}`, { method: "PATCH", body });
  else await api(`${cal()}/events`, { method: "POST", body });
  for (const e of extra) await api(`${cal()}/events/${encodeURIComponent(e.id)}`, { method: "DELETE" });
}

/** Removes a task's mirrored slot, if it has one. */
export async function deleteTaskSlot(gid: string): Promise<void> {
  for (const e of await slotEvents(gid)) await api(`${cal()}/events/${encodeURIComponent(e.id)}`, { method: "DELETE" });
}

/** Adds one more block of study time on a task. */
export async function createStudySession(task: StudyTask, input: { date: string; start: number; duration: number }): Promise<void> {
  const tz = timeZone();
  await api(`${cal()}/events`, {
    method: "POST",
    body: {
      summary: task.name,
      start: { dateTime: wallClock(input.date, input.start), timeZone: tz },
      end: { dateTime: wallClock(input.date, input.start + input.duration), timeZone: tz },
      colorId: STUDY_COLOR,
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: studyTag(task.gid, "session", task.project) },
    },
  });
}

/** Moves or resizes one occurrence. Only life blocks and study sessions the portal made can be changed. */
export async function moveLifeBlock(eventId: string, date: string, start: number, duration: number): Promise<void> {
  await assertPortalEvent(eventId);
  const tz = timeZone();
  await api(`${cal()}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: {
      start: { dateTime: wallClock(date, start), timeZone: tz },
      end: { dateTime: wallClock(date, start + duration), timeZone: tz },
    },
  });
}

/** Deletes one occurrence, or the whole series. Only life blocks and study sessions the portal made. */
export async function deleteLifeBlock(eventId: string, wholeSeries: boolean): Promise<void> {
  const event = await assertPortalEvent(eventId);
  const target = wholeSeries && event.recurringEventId ? event.recurringEventId : eventId;
  await api(`${cal()}/events/${encodeURIComponent(target)}`, { method: "DELETE" });
}

async function assertPortalEvent(eventId: string): Promise<GoogleEvent> {
  if (!/^[a-zA-Z0-9_]{5,1024}$/.test(eventId)) throw new GoogleError("That is not a calendar event id.", 400);
  const event = await api<GoogleEvent>(`${cal()}/events/${encodeURIComponent(eventId)}`);
  if (!isEditable(readTag(event.extendedProperties?.private))) {
    throw new GoogleError("Only blocks made in the portal can be changed here. Edit this one in Google Calendar.", 403);
  }
  return event;
}
