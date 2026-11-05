"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LinkPending } from "./link-pending";
import { QuickAddButton, openQuickAdd } from "./quick-add";

type NavLink = { href: string; title: string };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
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

/** The nav on tablets and up: main places, with the rest under More. */
export function NavLinks({ primary, more, canAdd }: { primary: NavLink[]; more: NavLink[]; canAdd: boolean }) {
  const pathname = usePathname();
  const menu = useMenu();
  const moreActive = more.some((l) => isActive(pathname, l.href));
  return (
    <nav aria-label="Main" className="hidden items-center gap-x-5 md:flex">
      {primary.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className={`text-sm transition-colors hover:text-white ${isActive(pathname, l.href) ? "font-medium text-white" : "text-neutral-400"}`}
        >
          {l.title}
        <LinkPending />
        </Link>
      ))}
      {more.length > 0 && (
        <details ref={menu} className="relative">
          <summary className={`cursor-pointer list-none text-sm transition-colors hover:text-white [&::-webkit-details-marker]:hidden ${moreActive ? "font-medium text-white" : "text-neutral-400"}`}>
            More <span aria-hidden>▾</span>
          </summary>
          <MenuItems links={more} className="absolute top-8 right-0 w-48" />
        </details>
      )}
      {canAdd && <QuickAddButton className="btn-primary px-4 py-1.5" />}
    </nav>
  );
}

function MenuItems({ links, className = "" }: { links: NavLink[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={`z-40 space-y-1 rounded-xl bg-navy p-2 shadow-2xl ring-1 ring-white/15 ${className}`}>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className={`block rounded-lg px-3 py-2 text-sm hover:bg-white/10 ${isActive(pathname, l.href) ? "text-white" : "text-neutral-300"}`}
        >
          {l.title}
        <LinkPending />
        </Link>
      ))}
      <form action="/auth/signout" method="post">
        <button className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-neutral-400 hover:bg-white/10 hover:text-white">Sign out</button>
      </form>
    </div>
  );
}

/** The nav on phones: a thumb-reach bar at the bottom. */
export function TabBar({ primary, more, canAdd }: { primary: NavLink[]; more: NavLink[]; canAdd: boolean }) {
  const pathname = usePathname();
  const menu = useMenu();
  const tabs = primary.slice(0, canAdd ? 3 : 4);
  // Whatever does not fit on the bar stays reachable under More.
  const overflow = [...primary.slice(tabs.length), ...more];
  const moreActive = overflow.some((l) => isActive(pathname, l.href));
  const item = (active: boolean) => `flex min-h-12 flex-1 flex-col items-center justify-center text-xs ${active ? "font-semibold text-white" : "text-neutral-400"}`;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/10 bg-primary/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      {tabs.slice(0, 2).map((l) => (
        <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className={item(isActive(pathname, l.href))}>{l.title}<LinkPending /></Link>
      ))}
      {canAdd && (
        <button type="button" onClick={openQuickAdd} aria-label="Add a task" className="my-1 flex min-h-11 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-r from-royal to-lavender text-2xl leading-none">
          +
        </button>
      )}
      {tabs.slice(2).map((l) => (
        <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className={item(isActive(pathname, l.href))}>{l.title}<LinkPending /></Link>
      ))}
      <details ref={menu} className="flex flex-1">
        <summary className={`${item(moreActive)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>More</summary>
        <MenuItems links={overflow} className="absolute right-2 bottom-16 w-56" />
      </details>
    </nav>
  );
}
