"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import * as ops from "@/lib/operations";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string };

const plain = ({ error }: ActionResult): ActionResult => (error ? { error } : {});

export async function scheduleTask(input: { gid: string; date: string; start: number; duration: number }): Promise<ActionResult> {
  await requireOwner();
  return plain(await ops.scheduleTask(input));
}

export async function unscheduleTask(input: { gid: string; date: string }): Promise<ActionResult> {
  await requireOwner();
  return ops.unscheduleTask(input);
}

export async function addLifeBlock(input: {
  kind: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  repeat: string;
}): Promise<ActionResult> {
  await requireOwner();
  return ops.addLifeBlock(input);
}

export async function moveBlock(input: {
  source: "asana" | "google";
  id: string;
  date: string;
  start: number;
  duration: number;
}): Promise<ActionResult> {
  await requireOwner();
  if (input.source === "asana") return plain(await ops.scheduleTask({ gid: input.id, ...input }));
  return ops.moveLifeBlockTo(input);
}

export async function removeLifeBlock(input: { id: string; wholeSeries: boolean }): Promise<ActionResult> {
  await requireOwner();
  return ops.removeLifeBlock(input);
}

export async function disconnectGoogle(): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  await supabase.rpc("clear_google_connection");
  revalidatePath("/schedule");
}
