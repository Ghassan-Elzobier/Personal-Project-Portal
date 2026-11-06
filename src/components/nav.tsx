import Link from "next/link";
import { getAccess } from "@/lib/auth/access";
import { timeZone, usesAsana } from "@/lib/config/env";
import { toolsFor } from "@/lib/config/tools";
import { dateIn } from "@/lib/dates/week";
import { NavLinks, TabBar } from "./nav-links";
import { QuickAdd } from "./quick-add";
import { SessionPill } from "./session-timer";

function Brand() {
  return (
    <Link href="/" className="text-xl font-bold text-neutral-400 transition-colors hover:text-white">
      Ghassan<span className="text-lavender">.</span>portal
    </Link>
  );
}

function Bar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 w-full bg-primary/80 backdrop-blur-lg">
      <div className="c-space mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
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
  const tools = toolsFor(access.role).filter((t) => (t.key !== "tasks" && t.key !== "study" && t.key !== "jobs") || !usesAsana());
  const links = (group: "primary" | "more") =>
    tools.filter((t) => t.group === group).map((t) => ({ href: t.href, title: t.key === "today" && !owner ? "Home" : t.title }));
  const primary = owner ? links("primary") : [{ href: "/", title: "Home" }, ...links("primary")];
  const more = links("more");

  return (
    <>
      <Bar>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {owner && <SessionPill />}
          <NavLinks primary={primary} more={more} canAdd={canAdd} />
        </div>
      </Bar>
      <TabBar primary={primary} more={more} canAdd={canAdd} />
      {owner && <QuickAdd today={dateIn(new Date(), timeZone())} />}
    </>
  );
}
