"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { QuickAddButton, openQuickAdd } from "./quick-add";

type NavLink = { href: string; title: string };
type SpaceLinks = { primary: NavLink[]; more: NavLink[] };
export type NavSpaces = { shared: NavLink[]; work: SpaceLinks; life: SpaceLinks };
type SpaceKey = "work" | "life";

const COOKIE = "portal-space";
const EVENT = "portal:space";
const LAST = "portal.lastPage.";
const HOME: Record<SpaceKey, string> = { work: "/", life: "/life" };
// Pages that belong to both spaces keep whichever space you were last in.
const SHARED = ["/", "/schedule"];

/** The space a page belongs to, or null for the shared ones. */
function spaceOf(pathname: string): SpaceKey | null {
  if (pathname === "/life" || pathname.startsWith("/life/")) return "life";
  return SHARED.includes(pathname) ? null : "work";
}

function remember(space: SpaceKey) {
  document.cookie = `${COOKIE}=${space}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: space }));
}

/** The current space: from the page when it has one, otherwise the last one you used. */
function useSpace(initial: SpaceKey): SpaceKey {
  const pathname = usePathname();
  const own = spaceOf(pathname);
  const [last, setLast] = useState<SpaceKey>(initial);
  // Arriving on a page that belongs to a space makes it the last one used. Only
  // on arrival: this must not run again when the switch changes, or a tap on Work
  // from a Life page would be undone before the Work page loads.
  useEffect(() => {
    if (!own) return;
    setLast(own);
    remember(own);
  }, [own]);
  // Remember the page you were on in this space, so switching back returns to it.
  useEffect(() => {
    if (!own) return;
    try {
      localStorage.setItem(LAST + own, pathname + window.location.search);
    } catch {
      // Private mode or blocked storage: the switch falls back to the space's home.
    }
  }, [own, pathname]);
  useEffect(() => {
    const on = (e: Event) => setLast((e as CustomEvent<SpaceKey>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return own ?? last;
}

/** The most specific link a path is under, so /life/gym lights Gym and not Meals. */
function activeHref(pathname: string, links: NavLink[]): string | null {
  let best: string | null = null;
  for (const l of links) {
    const hit = l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(`${l.href}/`);
    if (hit && (!best || l.href.length > best.length)) best = l.href;
  }
  return best;
}

/** Closes a details menu when you navigate or click elsewhere. */
function useMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return menu;
}

/**
 * Work or Life. A real link to the last page you used in that space (or its home),
 * so it works before the page's script loads, shows the loading bar, and lights
 * up the moment you tap it rather than when the next page arrives.
 */
export function SpaceSwitch({ initial }: { initial: SpaceKey }) {
  const space = useSpace(initial);
  const [targets, setTargets] = useState<Record<SpaceKey, string>>(HOME);
  const [tapped, setTapped] = useState<SpaceKey | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    setTapped(null);
    try {
      setTargets({ work: localStorage.getItem(LAST + "work") || HOME.work, life: localStorage.getItem(LAST + "life") || HOME.life });
    } catch {
      setTargets(HOME);
    }
  }, [pathname]);
  // Each history entry keeps the space it was seen in, so Back shows Today or the
  // Schedule as you left them, not in whichever space you were in since. Not while
  // a tap is on its way to another page: that space belongs to the page arriving.
  useEffect(() => {
    if (tapped) return;
    try {
      if (window.history.state?.portalSpace !== space) window.history.replaceState({ ...window.history.state, portalSpace: space }, "");
    } catch {
      // Without history state, a shared page keeps the last space used.
    }
  }, [space, pathname, tapped]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { portalSpace?: unknown } | null)?.portalSpace;
      if (s === "work" || s === "life") remember(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const shown = tapped ?? space;
  return (
    <nav aria-label="Space" className="flex shrink-0 rounded-full bg-white/5 p-0.5 text-sm ring-1 ring-white/10">
      {(["work", "life"] as const).map((s) => (
        <Link
          key={s}
          href={s === space ? HOME[s] : targets[s]}
          aria-current={shown === s ? "true" : undefined}
          onClick={(e) => {
            remember(s);
            // The space you are in, even mid-way through switching away, puts the switch back on it.
            if (s === space) return setTapped(null);
            // Already on the page it opens (Today, say): only the space changes.
            const href = e.currentTarget.getAttribute("href");
            setTapped(href === window.location.pathname + window.location.search ? null : s);
          }}
          className={`flex min-h-9 items-center rounded-full px-3.5 font-medium transition ${shown === s ? (s === "life" ? "bg-mint text-primary" : "bg-lavender text-white") : "text-neutral-400 hover:text-white"}`}
        >
          {s === "work" ? "Work" : "Life"}
        </Link>
      ))}
    </nav>
  );
}

/** The nav on tablets and up: shared places, then this space's, with the rest under More. */
export function NavLinks({ spaces, initial, canAdd }: { spaces: NavSpaces; initial: SpaceKey; canAdd: boolean }) {
  const pathname = usePathname();
  const space = useSpace(initial);
  const menu = useMenu();
  const own = spaces[space];
  const all = [...spaces.shared, ...own.primary, ...own.more];
  const active = activeHref(pathname, all);
  const moreActive = own.more.some((l) => l.href === active);
  const accent = space === "life" ? "text-mint" : "text-white";
  return (
    <nav aria-label="Main" className="hidden items-center gap-x-5 md:flex">
      {[...spaces.shared, ...own.primary].map((l, i) => (
        <span key={l.href} className="flex items-center gap-x-5">
          {i === spaces.shared.length && spaces.shared.length > 0 && <span className="h-4 w-px bg-white/15" aria-hidden />}
          <Link
            href={l.href}
            aria-current={active === l.href ? "page" : undefined}
            className={`text-sm whitespace-nowrap transition-colors hover:text-white ${active === l.href ? `font-medium ${accent}` : "text-neutral-400"}`}
          >
            {l.title}
            
          </Link>
        </span>
      ))}
      {own.more.length > 0 && (
        <details ref={menu} className="relative">
          <summary className={`cursor-pointer list-none text-sm transition-colors hover:text-white [&::-webkit-details-marker]:hidden ${moreActive ? `font-medium ${accent}` : "text-neutral-400"}`}>
            More <span aria-hidden>▾</span>
          </summary>
          <MenuItems links={own.more} active={active} className="absolute top-8 right-0 w-52" />
        </details>
      )}
      {canAdd && space === "work" && <QuickAddButton className="btn-primary px-4 py-1.5" />}
    </nav>
  );
}

function MenuItems({ links, active, className = "" }: { links: NavLink[]; active: string | null; className?: string }) {
  return (
    <div className={`z-40 space-y-1 rounded-xl bg-navy p-2 shadow-2xl ring-1 ring-white/15 ${className}`}>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active === l.href ? "page" : undefined}
          className={`block rounded-lg px-3 py-2.5 text-sm hover:bg-white/10 ${active === l.href ? "text-white" : "text-neutral-300"}`}
        >
          {l.title}
          
        </Link>
      ))}
      <form action="/auth/signout" method="post">
        <button className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm text-neutral-400 hover:bg-white/10 hover:text-white">Sign out</button>
      </form>
    </div>
  );
}

/**
 * The nav on phones: a thumb-reach bar at the bottom with Today and this space's
 * main places. Work keeps the add button in the middle; Life has one more place
 * instead. Everything else is under More.
 */
export function TabBar({ spaces, initial, canAdd }: { spaces: NavSpaces; initial: SpaceKey; canAdd: boolean }) {
  const pathname = usePathname();
  const space = useSpace(initial);
  const menu = useMenu();
  const own = spaces[space];
  const today = spaces.shared.find((l) => l.href === "/");
  const rest = spaces.shared.filter((l) => l.href !== "/");
  const add = canAdd && space === "work";
  const slots = add ? 3 : 4;
  const candidates = [...(today ? [today] : []), ...own.primary, ...rest];
  const tabs = candidates.slice(0, slots);
  // Whatever does not fit on the bar stays reachable under More.
  const overflow = [...candidates.slice(slots), ...own.more];
  const active = activeHref(pathname, [...candidates, ...own.more]);
  const moreActive = overflow.some((l) => l.href === active);
  const accent = space === "life" ? "text-mint" : "text-white";
  const item = (on: boolean) => `relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center px-1 text-xs ${on ? `font-semibold ${accent}` : "text-neutral-400"}`;
  const tab = (l: NavLink) => (
    <Link key={l.href} href={l.href} aria-current={active === l.href ? "page" : undefined} className={item(active === l.href)}>
      {active === l.href && <span className={`absolute top-0 h-0.5 w-8 rounded-full ${space === "life" ? "bg-mint" : "bg-lavender"}`} aria-hidden />}
      <span className="max-w-full truncate">{l.title}</span>
      
    </Link>
  );
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/10 bg-primary/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      {tabs.slice(0, 2).map(tab)}
      {add && (
        <button type="button" onClick={openQuickAdd} aria-label="Add a task" className="my-1.5 flex min-h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-r from-royal to-lavender text-2xl leading-none">
          +
        </button>
      )}
      {tabs.slice(2).map(tab)}
      <details ref={menu} className="flex min-w-0 flex-1">
        <summary className={`${item(moreActive)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>More</summary>
        <MenuItems links={overflow} active={active} className="absolute right-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] max-h-[70dvh] w-60 overflow-y-auto" />
      </details>
    </nav>
  );
}
