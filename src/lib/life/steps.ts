// A recipe's method at the size it is cooked: amounts written into the steps ("450
// ml water", "stock made up to 700 ml") scale with the batch like the ingredient
// list, so a rice dish sized up gets the water it needs. Temperatures, times and
// counts ("cut into 6") stay as written. Pure, so it is tested.

import type { Recipe } from "./recipes.ts";

const AMOUNT = /(\d+(?:\.\d+)?)\s?(ml|g|litres?|tbsp|tsp)\b/g;

/** "680 ml", "1.4 litres", "1.5 tbsp": an amount rounded the way a cook measures it. */
function measure(n: number, unit: string): string {
  if (unit === "ml" || unit === "g") {
    if (unit === "ml" && n >= 1000) return `${Math.round(n / 100) / 10} litres`;
    return `${n >= 100 ? Math.round(n / 10) * 10 : Math.max(5, Math.round(n / 5) * 5)} ${unit}`;
  }
  if (unit.startsWith("litre")) return `${Math.round(n * 10) / 10} litres`;
  return `${Math.max(0.5, Math.round(n * 2) / 2)} ${unit}`;
}

/**
 * The steps for `portions` at `scale` (as the ingredient list is: portions against
 * the recipe's own, times the portion size). A step about each portion scales with
 * the portion size alone.
 */
export function scaledSteps(r: Recipe, portions: number, scale: number): string[] {
  const batch = (portions / r.portions) * scale;
  return r.steps.map((step) => {
    const k = /\b(each|per) portion\b/i.test(step) ? scale : batch;
    if (Math.abs(k - 1) < 0.03) return step;
    return step.replace(AMOUNT, (_, n: string, unit: string) => measure(Number(n) * k, unit));
  });
}
