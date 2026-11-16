import { Chip } from "@/components/ui";
import type { SessionKind, SessionRow } from "@/lib/tutor/store";

export function KindChip({ kind }: { kind: SessionKind }) {
  return <Chip tone={kind === "teach" ? "aqua" : "lilac"}>{kind === "teach" ? "Lesson" : "Practice"}</Chip>;
}

export function StatusChip({ status }: { status: SessionRow["status"] }) {
  return status === "done" ? (
    <Chip tone="mint">Finished</Chip>
  ) : status === "open" ? (
    <Chip tone="sand">In progress</Chip>
  ) : (
    <Chip tone="quiet">Dropped</Chip>
  );
}
