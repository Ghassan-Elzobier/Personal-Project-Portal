import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { loadLife } from "@/lib/life/load";
import { RECIPES } from "@/lib/life/recipes";
import { ErrorNote } from "@/components/ui";
import { LifeHeader } from "../parts";
import { SettingsForm } from "./form";

export const metadata: Metadata = { title: "Life settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [, loaded] = await Promise.all([requireOwner(), loadLife()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Settings" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <LifeHeader eyebrow="Life" title="Settings">
        Everything here stays in your private database. Nothing about your body or food rules is in the portal&apos;s code.
      </LifeHeader>
      <SettingsForm
        profile={loaded.state.profile}
        recipes={RECIPES.filter((r) => r.meal !== "breakfast").map((r) => ({ key: r.key, name: r.name }))}
        allRecipes={RECIPES.map((r) => ({ key: r.key, name: r.name }))}
      />
    </div>
  );
}
