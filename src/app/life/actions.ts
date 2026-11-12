"use server";

import { requireOwner } from "@/lib/auth/access";
import type { Tag } from "@/lib/life/allergens";
import type { Unit } from "@/lib/life/ingredients";
import type { Slot } from "@/lib/life/nutrition";
import * as ops from "@/lib/life/operations";
import type { LifeProfile } from "@/lib/life/profile";

// The Life pages' buttons. Each checks for the owner, then runs the shared operation.

export async function saveProfile(profile: LifeProfile) {
  await requireOwner();
  return ops.saveProfile(profile);
}

export async function logWeight(day: string, kg: number | null) {
  await requireOwner();
  return ops.logWeight(day, kg);
}

export async function applyAdjustment() {
  await requireOwner();
  return ops.applyAdjustment();
}

export async function planWeek(start?: string) {
  await requireOwner();
  return ops.planWeek(start);
}

export async function swapCook(start: string, cookId: string, recipe: string) {
  await requireOwner();
  return ops.swapCook(start, cookId, recipe);
}

export async function addCook(start: string, recipe: string, date: string, minutes: number) {
  await requireOwner();
  return ops.addCook(start, recipe, date, minutes);
}

export async function removeCook(start: string, cookId: string) {
  await requireOwner();
  return ops.removeCook(start, cookId);
}

export async function setDaily(start: string, slot: "breakfast" | "shake", recipe: string) {
  await requireOwner();
  return ops.setDaily(start, slot, recipe);
}

export async function setOut(start: string, id: string, out: boolean) {
  await requireOwner();
  return ops.setOut(start, id, out);
}

export async function setFresh(start: string, date: string, slot: Slot, recipe: string | null) {
  await requireOwner();
  return ops.setFresh(start, date, slot, recipe);
}

export async function logMeal(day: string, slot: Slot, status: "eaten" | "skipped" | null) {
  await requireOwner();
  return ops.logMeal(day, slot, status);
}

export async function logPastAsEaten() {
  await requireOwner();
  return ops.logPastAsEaten();
}

export async function rate(recipe: string, stars: number | null, note?: string) {
  await requireOwner();
  return ops.rate(recipe, stars, note);
}

export async function cookPlanned(start: string, cookId: string) {
  await requireOwner();
  return ops.cookPlanned(start, cookId);
}

export async function cookExtra(recipe: string, portions: number) {
  await requireOwner();
  return ops.cookExtra(recipe, portions);
}

export async function uncook(batch: string) {
  await requireOwner();
  return ops.uncook(batch);
}

export async function setBatch(batch: string, remaining: number | null, location: "fridge" | "freezer" | null) {
  await requireOwner();
  return ops.setBatch(batch, remaining, location);
}

export async function setStock(changes: { item: string; qty?: number; status?: "have" | "low" | "out" | null; good_until?: string | null }[], mode: "add" | "set") {
  await requireOwner();
  return ops.setStock(changes, mode);
}

export async function markOrdered(start: string, ordered: boolean) {
  await requireOwner();
  return ops.markOrdered(start, ordered);
}

export async function confirmDelivery(start: string, got: string[]) {
  await requireOwner();
  return ops.confirmDelivery(start, got);
}

export async function undoDelivery(start: string) {
  await requireOwner();
  return ops.undoDelivery(start);
}

export async function saveProduct(input: { item: string; url: string; name: string; packQty: number; packUnit: Unit; pence: number | null; checked: Tag[] }) {
  await requireOwner();
  return ops.saveProduct(input);
}

export async function removeProduct(item: string) {
  await requireOwner();
  return ops.removeProduct(item);
}

export async function logSet(input: { day: string; workout: string; exercise: string; position: number; kg: number | null; reps: number | null; rir: number | null }) {
  await requireOwner();
  return ops.logSet(input);
}

export async function gymSession(input: { day: string; workout: string; finished?: boolean; feel?: number | null; notes?: string | null; remove?: boolean }) {
  await requireOwner();
  return ops.gymSession(input);
}

export async function syncLifeCalendar() {
  await requireOwner();
  return ops.syncLifeCalendar();
}
