import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { clientLabel } from "@/lib/connector/oauth";
import { ErrorNote } from "@/components/ui";
import { decide } from "./actions";
import { parseAuthorize } from "./request";

export const metadata: Metadata = { title: "Connect Claude" };
export const dynamic = "force-dynamic";

const CAN = [
  "Read today, your week and your open tasks",
  "Put tasks in time slots and add lunch, gym and other life blocks",
  "Log study sessions and draft or post Sunday updates",
];

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireOwner();
  const raw = await searchParams;
  const req = parseAuthorize(raw);

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="space-y-6 card p-8">
        {!req.ok ? (
          <ErrorNote title="Can't connect" message={req.error} />
        ) : (
          <>
            <div className="space-y-2">
              <p className="eyebrow">Connector</p>
              <h1 className="text-3xl font-bold">Let {clientLabel(req.value.redirectUri)} use your portal?</h1>
              <p className="subtext">It will be able to:</p>
            </div>
            <ul className="space-y-2 text-sm">
              {CAN.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-mint">✓</span>
                  {c}
                </li>
              ))}
            </ul>
            <p className="text-xs text-neutral-400">
              Claude asks you before each change. You can disconnect it any time from the Claude page.
            </p>
            <form action={decide} className="flex gap-3">
              {Object.entries(raw).map(([k, v]) =>
                v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />,
              )}
              <button name="decision" value="allow" className="btn-primary btn flex-1">
                Allow
              </button>
              <button name="decision" value="deny" className="btn-ghost flex-1">
                Cancel
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
