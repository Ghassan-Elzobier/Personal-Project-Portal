import { Chip, type Tone } from "@/components/ui";
import type { Plan, PlanStatus } from "@/lib/tutor/plan";

const STATUS: Record<PlanStatus, { label: string; tone: Tone }> = {
  done: { label: "Done", tone: "mint" },
  next: { label: "Next", tone: "aqua" },
  todo: { label: "To do", tone: "quiet" },
};

/** The lesson's map as a list: each landmark with what it comes after. */
export function PlanList({ plan }: { plan: Plan }) {
  const label = new Map(plan.nodes.map((n) => [n.id, n.label]));
  return (
    <ol className="space-y-2">
      {plan.nodes.map((n) => {
        const after = plan.edges.filter(([, to]) => to === n.id).map(([from]) => label.get(from) ?? from);
        return (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 card">
            <div className="min-w-0">
              <p className="font-semibold">{n.label}</p>
              {after.length > 0 && <p className="text-sm text-muted">After: {after.join(", ")}</p>}
            </div>
            <Chip tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Chip>
          </li>
        );
      })}
    </ol>
  );
}
