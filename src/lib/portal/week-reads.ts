// A schedule week's reads, started together. The Google Calendar read needs only
// the week, so it runs beside the task reads instead of waiting for them.
// Kept apart from schedule.ts (server-only) so the order can be tested.

export type CalendarRead<C, E> =
  | "not-configured"
  | "not-connected"
  | { connection: C; events: E[] }
  /** Connected, but the events could not be read. */
  | { connection: C; error: unknown };

export type WeekReads<T, C, E> = {
  tasks: () => Promise<T>;
  googleConfigured: () => boolean;
  connection: () => Promise<C | null>;
  events: () => Promise<E[]>;
};

async function readCalendar<C, E>(reads: WeekReads<unknown, C, E>): Promise<CalendarRead<C, E>> {
  if (!reads.googleConfigured()) return "not-configured";
  const connection = await reads.connection();
  if (!connection) return "not-connected";
  try {
    return { connection, events: await reads.events() };
  } catch (error) {
    // A failed calendar read never takes the week down.
    return { connection, error };
  }
}

export async function readWeek<T, C, E>(
  reads: WeekReads<T, C, E>,
): Promise<{ tasks: T; calendar: CalendarRead<C, E> }> {
  // One Promise.all holds both, so a failure in either is never left unhandled.
  const [calendar, tasks] = await Promise.all([readCalendar(reads), reads.tasks()]);
  return { tasks, calendar };
}
