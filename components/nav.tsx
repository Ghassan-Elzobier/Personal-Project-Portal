import Link from "next/link";
import { getAccess } from "@/lib/access";
import { toolsFor } from "@/lib/tools";
import { NavLinks } from "./nav-links";

export async function Nav() {
  const access = await getAccess();
  const tools = access ? toolsFor(access.role).filter((t) => t.key !== "today") : [];
  const links = [{ href: "/", title: access?.role === "owner" ? "Today" : "Home" }, ...tools];

  return (
    <div className="sticky top-0 z-20 w-full bg-primary/40 backdrop-blur-lg">
      <div className="c-space mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Link href="/" className="text-xl font-bold text-neutral-400 transition-colors hover:text-white">
          Ghassan<span className="text-lavender">.</span>portal
        </Link>
        {access && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <NavLinks links={links.map((l) => ({ href: l.href, title: l.title }))} />
            <form action="/auth/signout" method="post">
              <button className="cursor-pointer text-sm text-neutral-500 transition-colors hover:text-white">
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
