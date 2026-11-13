// Allergy and food rules, with the nuance real allergies have. Egg in a cake is
// not egg in an omelette: heat and a flour matrix change how allergenic it is, which
// is why UK allergy clinics use an "egg ladder" from baked to raw (BSACI 2021 egg
// allergy guideline). So a rule can allow some forms of a food and block the rest.
//
// The rules themselves are the owner's, stored in the database, never in this
// public repo. This file only knows how to apply them. Pure, so it is tested.

export type Tag =
  // The UK's 14 labelled allergens, split where it matters.
  | "egg"
  | "milk"
  | "gluten"
  | "peanut"
  | "tree-nut"
  | "soy"
  | "lupin"
  | "sesame"
  | "fish"
  | "crustacean"
  | "mollusc"
  | "mustard"
  | "celery"
  | "sulphite"
  // Beyond the 14: legumes, nut oils and fruits that cross-react.
  | "nut-oil"
  | "pea"
  | "chickpea"
  | "lentil"
  | "bean"
  | "fenugreek"
  | "tamarind"
  | "legume-gum"
  | "coconut"
  | "apple"
  | "banana"
  | "pear"
  | "stone-fruit"
  | "kiwi"
  | "mango";

export const TAG_LABELS: Record<Tag, string> = {
  egg: "egg",
  milk: "milk",
  gluten: "gluten",
  peanut: "peanut",
  "tree-nut": "tree nuts",
  soy: "soya",
  lupin: "lupin",
  sesame: "sesame",
  fish: "fish",
  crustacean: "crustaceans",
  mollusc: "molluscs",
  mustard: "mustard",
  celery: "celery",
  sulphite: "sulphites",
  "nut-oil": "nut oils (groundnut, walnut, hazelnut)",
  pea: "peas and pea protein",
  chickpea: "chickpeas (and gram flour)",
  lentil: "lentils",
  bean: "beans (including green beans and mangetout)",
  fenugreek: "fenugreek (methi, in many curry powders)",
  tamarind: "tamarind (in Worcestershire, HP and BBQ sauces)",
  "legume-gum": "guar or locust bean gum",
  coconut: "coconut",
  apple: "apple (including juice concentrate and cider vinegar)",
  banana: "banana",
  pear: "pear",
  "stone-fruit": "stone fruit (peach, plum, cherry, apricot)",
  kiwi: "kiwi",
  mango: "mango",
};

/** Groups people say out loud: "no legumes" is nine tags. */
export const GROUPS: Record<string, { label: string; tags: Tag[] }> = {
  nuts: { label: "Nuts", tags: ["peanut", "tree-nut", "nut-oil"] },
  legumes: {
    label: "Legumes",
    tags: ["peanut", "soy", "lupin", "pea", "chickpea", "lentil", "bean", "fenugreek", "tamarind"],
  },
};

/**
 * How a food is in a dish, from most changed to least. The egg ladder's order:
 * baked into a flour matrix, then cooked in a batter, coating or fresh pasta, then
 * cooked as itself, then runny or raw. "processed" is a derivative such as a
 * juice concentrate, vinegar or refined oil.
 */
export const FORMS = ["baked", "batter", "coating", "pasta", "processed", "cooked", "runny", "raw"] as const;
export type Form = (typeof FORMS)[number];

export const FORM_LABELS: Record<Form, string> = {
  baked: "baked in (cake, bread, muffins)",
  batter: "in a batter (pancakes, Yorkshire puddings)",
  coating: "in a breaded or battered coating",
  pasta: "in fresh pasta or noodles",
  processed: "as a derivative (juice concentrate, vinegar, refined oil)",
  cooked: "cooked as itself",
  runny: "lightly cooked",
  raw: "raw",
};

export type Rule = {
  tag: Tag;
  /** avoid: never served unless the form is allowed. flag: served, and marked. */
  level: "avoid" | "flag";
  allowForms?: Form[];
  note?: string;
};

export type FoodRules = {
  rules: Rule[];
  /** Products with "may contain" warnings for these tags are fine. */
  mayContainOk: Tag[];
  /** Ingredients you just don't like. Not allergies, so recipes are hidden, not blocked. */
  dislikes: string[];
  /** Traits to steer away from, such as "strong" flavours. */
  avoidTraits: ("strong" | "spicy")[];
};

export const NO_RULES: FoodRules = { rules: [], mayContainOk: [], dislikes: [], avoidTraits: [] };

export function ruleFor(rules: FoodRules, tag: Tag): Rule | undefined {
  return rules.rules.find((r) => r.tag === tag);
}

export type Finding = {
  tag: Tag;
  item: string;
  /** What the dish does with it. */
  form: Form;
  verdict: "blocked" | "allowed" | "flagged";
  why: string;
};

/** What one food in one form means under the rules. */
export function judge(rules: FoodRules, tag: Tag, form: Form, item: string): Finding | null {
  const rule = ruleFor(rules, tag);
  if (!rule) return null;
  if (rule.allowForms?.includes(form)) {
    return {
      tag,
      item,
      form,
      verdict: "allowed",
      why: `${cap(TAG_LABELS[tag])} ${FORM_LABELS[form]} is fine for you.`,
    };
  }
  if (rule.level === "flag") {
    return {
      tag,
      item,
      form,
      verdict: "flagged",
      why: `Contains ${TAG_LABELS[tag]}${rule.note ? `: ${rule.note}` : ""}.`,
    };
  }
  return {
    tag,
    item,
    form,
    verdict: "blocked",
    why: `${cap(item)} has ${TAG_LABELS[tag]}${form === "cooked" ? "" : ` ${FORM_LABELS[form]}`}.`,
  };
}

/** A tag some brands add, optionally with the form it would be in: "egg:baked". */
export type Watch = Tag | `${Tag}:${Form}`;

export function splitWatch(w: Watch): { tag: Tag; form: Form } {
  const [tag, form] = w.split(":") as [Tag, Form | undefined];
  return { tag, form: form ?? "cooked" };
}

/**
 * Tags to look for on a product's label, for this person's rules only. Egg baked
 * into bread is not worth a check for someone who eats baked egg.
 */
export function labelChecks(rules: FoodRules, watch: readonly Watch[] | undefined): Tag[] {
  if (!watch) return [];
  const out: Tag[] = [];
  for (const w of watch) {
    const { tag, form } = splitWatch(w);
    const rule = ruleFor(rules, tag);
    if (!rule || rule.allowForms?.includes(form)) continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Every tag a rule list names, with groups expanded. */
export function expandGroups(names: string[]): Tag[] {
  const out = new Set<Tag>();
  for (const n of names) {
    const group = GROUPS[n];
    if (group) group.tags.forEach((t) => out.add(t));
    else if (n in TAG_LABELS) out.add(n as Tag);
  }
  return [...out];
}

/** Validates rules read from the database, dropping anything malformed. */
export function parseRules(raw: unknown): FoodRules {
  if (!raw || typeof raw !== "object") return NO_RULES;
  const r = raw as Record<string, unknown>;
  const isTag = (t: unknown): t is Tag => typeof t === "string" && t in TAG_LABELS;
  const isForm = (f: unknown): f is Form => typeof f === "string" && (FORMS as readonly string[]).includes(f);
  const rules: Rule[] = [];
  for (const item of Array.isArray(r.rules) ? r.rules : []) {
    if (!item || typeof item !== "object") continue;
    const x = item as Record<string, unknown>;
    if (!isTag(x.tag) || (x.level !== "avoid" && x.level !== "flag")) continue;
    if (rules.some((existing) => existing.tag === x.tag)) continue;
    rules.push({
      tag: x.tag,
      level: x.level,
      allowForms: Array.isArray(x.allowForms) ? x.allowForms.filter(isForm) : undefined,
      note: typeof x.note === "string" ? x.note.slice(0, 200) : undefined,
    });
  }
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 60)) : [];
  return {
    rules,
    mayContainOk: Array.isArray(r.mayContainOk) ? r.mayContainOk.filter(isTag) : [],
    dislikes: strings(r.dislikes),
    avoidTraits: strings(r.avoidTraits).filter((t): t is "strong" | "spicy" => t === "strong" || t === "spicy"),
  };
}
