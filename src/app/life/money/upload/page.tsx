import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { loadMoney } from "@/lib/money/load";
import { Empty, ErrorNote } from "@/components/ui";
import { LifeHeader } from "../../parts";
import { StatementForm } from "./form";

export const metadata: Metadata = { title: "Add a statement" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const [, loaded] = await Promise.all([requireOwner(), loadMoney()]);
  return (
    <div className="space-y-6">
      <p>
        <Link href="/life/money" className="text-sm text-muted hover:text-white">
          ← Money
        </Link>
      </p>
      <LifeHeader title="Add a statement">
        For days the bank feed missed. Download a statement as CSV from your internet banking and pick it here. Payments
        the portal already has are left out, so nothing is counted twice, and the file itself is not kept.
      </LifeHeader>
      {loaded.error !== undefined ? (
        <ErrorNote message={loaded.error} />
      ) : loaded.state.accounts.length === 0 ? (
        <Empty>
          Connect your bank on{" "}
          <Link href="/life/money" className="text-mint underline">
            Money
          </Link>{" "}
          first, so the statement has an account to go to.
        </Empty>
      ) : (
        <section aria-labelledby="statement-title" className="space-y-4 card-life">
          <h2 id="statement-title" className="font-semibold">
            Statement file
          </h2>
          <StatementForm
            accounts={loaded.state.accounts.map((a) => ({
              id: a.id,
              label: a.last4 ? `${a.name} ••${a.last4}` : a.name,
            }))}
          />
        </section>
      )}
    </div>
  );
}
