import Link from "next/link";
import { cookies } from "next/headers";
import { getAccess } from "@/lib/auth/access";
import { timeZone, usesAsana } from "@/lib/config/env";
import { toolsFor, type Space } from "@/lib/config/tools";
import { dateIn } from "@/lib/dates/week";
import { NavLinks, SpaceSwitch, TabBar, type NavSpaces } from "./nav-links";
import { QuickAdd } from "./quick-add";
import { SessionPill } from "./session-timer";
import { now } from "@/lib/dates/clock";

export const SPACE_COOKIE = "portal-space";

function Brand() {
  return (
    <Link href="/" className="shrink-0 text-xl font-bold text-neutral-400 transition-colors hover:text-white">
      Ghassan<span className="text-lavender">.</span>portal
    </Link>
  );
}

function Bar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 w-full bg-primary/80 backdrop-blur-lg">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 c-space py-2">
        <Brand />
        {children}
      </div>
    </div>
  );
}

export async function Nav() {
  const access = await getAccess();
  if (!access) return <Bar />;

  const owner = access.role === "owner";
  const canAdd = owner && !usesAsana();
  const tools = toolsFor(access.role)
    .filter((t) => !["tasks", "study", "jobs", "roadmap", "job-hunt"].includes(t.key) || !usesAsana())
    .filter((t) => !t.share || access.shares.includes(t.share));
  const title = (t: (typeof tools)[number]) => (owner && t.mentorView ? `${t.title} (mentor view)` : t.title);
  const link = (t: (typeof tools)[number]) => ({ href: t.href, title: title(t) });
  const pick = (space: Space, group: "primary" | "more") =>
    tools.filter((t) => t.space === space && t.group === group).map(link);

  if (!owner) {
    // A mentor has only a handful of places, so all of them stay in view, and there is no Life.
    const all = [{ href: "/", title: "Home" }, ...tools.map(link)];
    const spaces: NavSpaces = { shared: [], work: { primary: all, more: [] }, life: { primary: [], more: [] } };
    return (
      <>
        <Bar>
          <NavLinks spaces={spaces} initial="work" canAdd={false} />
        </Bar>
        <TabBar spaces={spaces} initial="work" canAdd={false} />
      </>
    );
  }

  const spaces: NavSpaces = {
    shared: pick("shared", "primary"),
    work: { primary: pick("work", "primary"), more: pick("work", "more") },
    life: { primary: pick("life", "primary"), more: pick("life", "more") },
  };
  const stored = (await cookies()).get(SPACE_COOKIE)?.value;
  const initial = stored === "life" ? "life" : "work";

  return (
    <>
      <Bar>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <SessionPill />
          <SpaceSwitch initial={initial} />
          <NavLinks spaces={spaces} initial={initial} canAdd={canAdd} />
        </div>
      </Bar>
      <TabBar spaces={spaces} initial={initial} canAdd={canAdd} />
      <QuickAdd today={dateIn(now(), timeZone())} />
    </>
  );
}
