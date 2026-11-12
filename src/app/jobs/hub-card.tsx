import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { shortDate } from "@/lib/dates/week";
import type { Hub } from "@/lib/jobs/load";
import type { Roadmap } from "@/lib/study/load";
import { BandChip } from "./views";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Studying, the market and the job hunt, side by side, so each explains the others. */
export function HubCard({ hub, roadmap, today }: { hub: Hub; roadmap: Roadmap; today: string }) {
  const phase = roadmap.current;
  const due = hub.actions.filter((a) => a.next_action_on && a.next_action_on <= today);
  return (
    <section aria-label="Your goals" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="card space-y-2">
        <p className="eyebrow">Studying</p>
        {phase ? (
          <>
            <p className="font-semibold">Phase {phase.index + 1} of {roadmap.phases.length}: {phase.phase.name}</p>
            <p className="text-sm text-neutral-300 tabular-nums">{phase.done} of {phase.total} done, about {Math.round(phase.hoursLeft)} h left</p>
            {hub.nextUnit && (
              <p className="text-sm text-neutral-300">
                Next:{" "}
                {hub.nextUnit.href ? <Link href={hub.nextUnit.href} className="text-aqua underline-offset-2 hover:underline">{hub.nextUnit.name}<LinkPending /></Link> : hub.nextUnit.name}
                {hub.nextUnit.skills.length > 0 && (
                  <span className="text-neutral-400">. It teaches {hub.nextUnit.skills.map((s) => `${s.name} (${s.must + s.soft} ${s.must + s.soft === 1 ? "role" : "roles"})`).join(", ")}.</span>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-300">Every phase is done.</p>
        )}
        <Link href="/study" className="block text-sm text-neutral-400 hover:text-white">Open the roadmap<LinkPending /></Link>
      </div>

      <div className="card space-y-2">
        <p className="eyebrow">The market</p>
        {hub.closest ? (
          <p className="text-sm text-neutral-300">
            Closest role:{" "}
            <Link href={`/jobs?role=${hub.closest.gid}`} className="font-medium text-white underline-offset-2 hover:underline">{hub.closest.title}<LinkPending /></Link>
            <span className="text-neutral-400">, {hub.closest.company} </span>
            <BandChip band={hub.closest.fit.band} />
          </p>
        ) : (
          <p className="text-sm text-neutral-300">No close match yet.</p>
        )}
        {hub.biggestGap && (
          <p className="text-sm text-neutral-300">
            Biggest gap: <span className="font-medium text-white">{hub.biggestGap.skill.name}</span>
            <span className="text-neutral-400">, required by {plural(hub.biggestGap.must, "role", "roles")} and not in your plan.</span>
          </p>
        )}
        {hub.nextSkill && (
          <p className="text-sm text-neutral-300">
            Most-asked skill on its way: <span className="font-medium text-white">{hub.nextSkill.skill.name}</span>
            <span className="text-neutral-400">, required by {plural(hub.nextSkill.must, "role", "roles")}.</span>
          </p>
        )}
        <Link href="/jobs?view=skills" className="block text-sm text-neutral-400 hover:text-white">See skills against the market<LinkPending /></Link>
      </div>

      <div className="card space-y-2">
        <p className="eyebrow">Job hunt</p>
        <p className="text-sm text-neutral-300 tabular-nums">
          {hub.fresh > 0 ? (
            <Link href="/jobs" className="text-white underline-offset-2 hover:underline">{plural(hub.fresh, "role", "roles")} new to you<LinkPending /></Link>
          ) : (
            "No new roles to look at"
          )}
          {hub.fresh > 0 && <span className="text-neutral-400">, {hub.freshNear} in London or remote</span>}
          {`. ${hub.active} in progress.`}
        </p>
        {due.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {due.slice(0, 2).map((a) => (
              <li key={a.gid}>
                <Link href={`/jobs?view=applications&role=${a.gid}`} className="text-sand underline-offset-2 hover:underline">{a.next_action}<LinkPending /></Link>
                <span className="text-neutral-400">, {a.company}</span>
              </li>
            ))}
          </ul>
        ) : hub.actions[0] ? (
          <p className="text-sm text-neutral-300">Next action: {hub.actions[0].next_action}, {shortDate(hub.actions[0].next_action_on as string)}</p>
        ) : (
          <p className="text-sm text-neutral-400">Nothing due. Choose up to two things to do this week.</p>
        )}
        {hub.failing > 0 && <p className="text-sm text-coral">{plural(hub.failing, "feed", "feeds")} could not be read last time.</p>}
        <Link href="/jobs?view=applications" className="block text-sm text-neutral-400 hover:text-white">Open applications<LinkPending /></Link>
      </div>
    </section>
  );
}
