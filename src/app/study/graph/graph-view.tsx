"use client";

import Link from "next/link";
import { useState } from "react";
import { filterGraph, type GraphGroup } from "@/lib/tutor/graph-view";
import { Empty, SectionTitle } from "@/components/ui";

/** The claims, with a search that needs every word. The filter is derived each render. */
export function GraphView({ groups }: { groups: GraphGroup[] }) {
  const [words, setWords] = useState("");
  const shown = filterGraph(groups, words);
  const total = groups.reduce((n, g) => n + g.claims.length, 0);

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="field-label">Search {total} ideas</span>
        <input
          type="search"
          className="field-input"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="tile, warp, bandwidth"
        />
      </label>

      {shown.length === 0 && <Empty>No idea has all of those words.</Empty>}

      {shown.map((g) => (
        <section key={g.unit ?? "none"} className="space-y-3">
          <SectionTitle>{g.unit ?? "Not tied to a unit"}</SectionTitle>
          <ul className="space-y-3">
            {g.claims.map((c) => (
              <li key={c.gid} className="space-y-2 card">
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-body">{c.statement}</p>
                {c.because.map((premises, i) => (
                  <p key={i} className="text-sm text-muted">
                    Follows from {premises.join(" and ")}
                  </p>
                ))}
                {c.leadsTo.length > 0 && <p className="text-sm text-muted">Leads to {c.leadsTo.join(", ")}</p>}
                {c.sessionGid && (
                  <p className="text-sm">
                    <Link href={`/study/learn/${c.sessionGid}`} className="link">
                      Taught in this lesson
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
