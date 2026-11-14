import { Chip } from "@/components/ui";

/** Where a bug stands, in a word: New (no issue yet), its issue, Ignored, or Test. */
export function ErrorStatus({ error }: { error: { status: string; issue_number: number | null; context: string } }) {
  if (error.context === "test") return <Chip tone="quiet">Test</Chip>;
  if (error.status === "ignored") return <Chip tone="quiet">Ignored</Chip>;
  if (error.status === "filed" && error.issue_number) return <Chip tone="aqua">Issue #{error.issue_number}</Chip>;
  return <Chip tone="coral">New</Chip>;
}
