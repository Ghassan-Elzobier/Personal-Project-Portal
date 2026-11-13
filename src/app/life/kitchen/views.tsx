"use client";

import { useMemo, useState } from "react";
import { toast } from "@/components/toaster";
import type { Tag } from "@/lib/life/allergens";
import type { Aisle, Unit } from "@/lib/life/ingredients";
import {
  confirmDelivery,
  cookExtra,
  cookPlanned,
  markOrdered,
  moveCookSession,
  removeProduct,
  saveProduct,
  setBatch,
  setStock,
  uncook,
  undoDelivery,
} from "../actions";
import { ActionButton, Sheet, useAction } from "../kit";

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

export type ShopLine = {
  item: string;
  name: string;
  aisle: Aisle;
  need: string;
  have: string | null;
  packs: number;
  pack: string;
  pence: number;
  price: string;
  estimate: boolean;
  spare: string | null;
  link: string;
  product: { name: string; url: string; packQty: number; packUnit: Unit; pence: number | null; checked: Tag[] } | null;
  checks: { tag: Tag; label: string }[];
  allChecks: { tag: string; label: string }[];
  freeze: boolean;
  firstUse: string;
  uses: string[];
  staple: boolean;
  defaultPack: { qty: number; unit: Unit };
  slugPack: { qty: number; unit: Unit } | null;
};

export function ShopView({
  start,
  lines,
  aisles,
  total,
  ordered,
  delivered,
  deliveryDay,
  unchecked,
}: {
  start: string;
  lines: ShopLine[];
  aisles: Aisle[];
  total: {
    price: string;
    food: string;
    cupboard: string | null;
    estimated: boolean;
    packs: number;
    budget: string | null;
    over: boolean;
  };
  ordered: string | null;
  delivered: string | null;
  deliveryDay: string;
  unchecked: { item: string; name: string }[];
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<ShopLine | null>(null);
  const [arrive, setArrive] = useState(false);
  const buying = lines.filter((l) => l.packs > 0);
  const covered = lines.filter((l) => l.packs === 0);
  const byAisle = useMemo(
    () => aisles.map((a) => ({ aisle: a, lines: buying.filter((l) => l.aisle === a) })).filter((g) => g.lines.length),
    [aisles, buying],
  );
  const { run } = useAction();

  const copy = async () => {
    const text = byAisle
      .map((g) => `${g.aisle}\n${g.lines.map((l) => `- ${l.product?.name ?? l.name} x${l.packs}`).join("\n")}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("List copied. Paste it into Sainsbury's SmartLists or a note.");
    } catch {
      toast("Couldn't copy on this device.", { tone: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 card-life">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-2xl font-bold tabular-nums">
            {total.estimated ? "≈ " : ""}
            {total.price}
          </p>
          <p className="text-sm text-muted tabular-nums">
            {total.packs} packs · {buying.length} items
          </p>
        </div>
        <p className="text-sm text-body tabular-nums">
          Food this week {total.food}
          {total.budget && <span className={total.over ? "text-sand" : "text-muted"}> of your {total.budget}</span>}
          {total.cupboard && <span className="text-muted"> · cupboard stock-up {total.cupboard}, lasts weeks</span>}
        </p>
        <p className="text-sm text-body">
          {delivered
            ? `Delivered ${delivered}. It's all in the cupboard tab.`
            : ordered
              ? `Ordered ${ordered}. When it arrives, tap Delivery arrived and untick anything missing.`
              : `For delivery by ${deliveryDay}. Tap each item to open it on Sainsbury's and add the packs shown. Pick a product once and the link goes straight to it every week.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!delivered && !ordered && (
            <ActionButton action={() => markOrdered(start, true)} className="btn-life" done="Marked as ordered.">
              I&apos;ve ordered it
            </ActionButton>
          )}
          {!delivered && (
            <button type="button" onClick={() => setArrive(true)} className={ordered ? "btn-life" : "btn-soft"}>
              Delivery arrived
            </button>
          )}
          {ordered && !delivered && (
            <ActionButton action={() => markOrdered(start, false)} className="btn-soft">
              Not ordered yet
            </ActionButton>
          )}
          {delivered && (
            <ActionButton
              action={() => undoDelivery(start)}
              className="btn-soft"
              confirm="Take this delivery back out of stock?"
            >
              Undo delivery
            </ActionButton>
          )}
          <button type="button" onClick={copy} className="btn-soft">
            Copy list
          </button>
        </div>
        {total.estimated && (
          <p className="text-xs text-faint">
            Prices marked ≈ are typical ones until you pick the product and its price.
          </p>
        )}
      </section>

      {unchecked.length > 0 && !delivered && <HaveThese items={unchecked} />}

      {byAisle.map((g) => (
        <section key={g.aisle} className="space-y-2" aria-label={g.aisle}>
          <h2 className="px-1 eyebrow">{g.aisle}</h2>
          <ul className="divide-y divide-white/5 card-life p-0">
            {g.lines.map((l) => {
              const seen = opened.has(l.item);
              return (
                <li key={l.item} className="flex min-w-0 items-start gap-3 p-3">
                  <a
                    href={l.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() => setOpened((s) => new Set(s).add(l.item))}
                    className={`tap size-11 shrink-0 rounded-full text-sm font-bold ring-1 ${seen ? "bg-mint text-primary ring-mint" : "bg-white/5 text-mint ring-mint/30"}`}
                    aria-label={`Open ${l.name} on Sainsbury's`}
                  >
                    {seen ? "✓" : `×${l.packs}`}
                  </a>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium wrap-break-word">
                      {l.product?.name ?? l.name} <span className="text-muted">× {l.packs}</span>
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {l.staple ? "Running low" : `${l.need} needed${l.have ? `, ${l.have} in` : ""}`} · {l.pack} packs
                      · {l.estimate ? "≈" : ""}
                      {l.price}
                      {l.spare ? ` · ${l.spare} spare` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.freeze && (
                        <span className="chip bg-sky-400/10 text-sky-300 ring-sky-400/25">
                          Freeze on arrival · for {l.firstUse}
                        </span>
                      )}
                      {l.checks.map((c) => (
                        <span key={c.tag} className="chip bg-sand/10 text-sand ring-sand/25">
                          Check label: {c.label.split(" (")[0]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPick(l)}
                    className="shrink-0 text-xs text-mint hover:underline"
                  >
                    {l.product ? "Product" : "Pick"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {covered.length > 0 && (
        <details className="card-life text-sm">
          <summary className="cursor-pointer text-body">Already in the kitchen ({covered.length})</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {covered.map((l) => (
              <li key={l.item}>
                {l.name}
                {l.have ? ` · ${l.have}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Sheet
        open={pick !== null}
        onClose={() => setPick(null)}
        title={pick ? `Sainsbury's product for ${pick.name.toLowerCase()}` : ""}
      >
        {pick && <ProductForm line={pick} onDone={() => setPick(null)} />}
      </Sheet>

      <Sheet open={arrive} onClose={() => setArrive(false)} title="What arrived?">
        {arrive && (
          <Arrived
            lines={buying}
            onConfirm={async (got) => {
              const ok = await run(() => confirmDelivery(start, got), "Delivery is in the kitchen.");
              if (ok) setArrive(false);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Staples nobody has said anything about yet: one tap each says you have it, so it isn't bought. */
function HaveThese({ items }: { items: { item: string; name: string }[] }) {
  const [have, setHave] = useState<Set<string>>(new Set());
  const { pending, run } = useAction();
  return (
    <section className="space-y-3 card-life" aria-labelledby="have-title">
      <div>
        <h2 id="have-title" className="font-semibold">
          Already have any of these?
        </h2>
        <p className="text-sm text-muted">
          Cupboard staples are tracked as have, low or out, not weighed. Tick what you have and it comes off the list.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <button
            key={i.item}
            type="button"
            aria-pressed={have.has(i.item)}
            onClick={() =>
              setHave((s) => {
                const n = new Set(s);
                if (n.has(i.item)) n.delete(i.item);
                else n.add(i.item);
                return n;
              })
            }
            className={`min-h-10 rounded-full px-3.5 text-sm ring-1 ${have.has(i.item) ? "bg-mint/15 text-mint ring-mint/40" : "bg-white/5 text-body ring-white/10"}`}
          >
            {i.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={pending || have.size === 0}
        aria-busy={pending}
        onClick={() =>
          void run(
            () =>
              setStock(
                [...have].map((item) => ({ item, status: "have" as const })),
                "set",
              ),
            "Taken off the list.",
          )
        }
        className="btn-life"
      >
        I have {have.size || "these"}
      </button>
    </section>
  );
}

function Arrived({ lines, onConfirm }: { lines: ShopLine[]; onConfirm: (got: string[]) => Promise<void> }) {
  const [got, setGot] = useState<Set<string>>(new Set(lines.map((l) => l.item)));
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-body">
        Everything is ticked. Untick what was missing or substituted with something you won&apos;t use.
      </p>
      <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
        {lines.map((l) => (
          <li key={l.item}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-white/5">
              <input
                type="checkbox"
                checked={got.has(l.item)}
                onChange={() =>
                  setGot((s) => {
                    const n = new Set(s);
                    if (n.has(l.item)) n.delete(l.item);
                    else n.add(l.item);
                    return n;
                  })
                }
                className="size-5 accent-mint"
              />
              <span className="min-w-0 flex-1 truncate">{l.product?.name ?? l.name}</span>
              <span className="text-xs text-muted">× {l.packs}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          await onConfirm([...got]);
          setBusy(false);
        }}
        className="btn-life w-full"
      >
        Put {got.size} {got.size === 1 ? "item" : "items"} away
      </button>
    </div>
  );
}

function ProductForm({ line, onDone }: { line: ShopLine; onDone: () => void }) {
  const p = line.product;
  const [url, setUrl] = useState(p?.url ?? "");
  const [name, setName] = useState(p?.name ?? "");
  const [qty, setQty] = useState(String(p?.packQty ?? line.slugPack?.qty ?? line.defaultPack.qty));
  const [unit, setUnit] = useState<Unit>(p?.packUnit ?? line.slugPack?.unit ?? line.defaultPack.unit);
  const [price, setPrice] = useState(p?.pence != null ? (p.pence / 100).toFixed(2) : "");
  const [checked, setChecked] = useState<Set<string>>(new Set(p?.checked ?? []));
  const { pending, run } = useAction();
  const fromSlug = (u: string) => {
    const slug = u.split("?")[0].split("/").pop() ?? "";
    const m = /(\d+(?:\.\d+)?)(kg|g|ml|l)(?:-|$)/.exec(slug);
    if (m) {
      const n = Number(m[1]);
      setQty(String(m[2] === "kg" || m[2] === "l" ? n * 1000 : n));
      setUnit(m[2] === "ml" || m[2] === "l" ? "ml" : "g");
    }
    if (!name)
      setName(
        slug
          .replace(/-/g, " ")
          .replace(/^sainsburys /, "Sainsbury's ")
          .replace(/^\w/, (c) => c.toUpperCase()),
      );
  };
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          () =>
            saveProduct({
              item: line.item,
              url,
              name,
              packQty: Number(qty),
              packUnit: unit,
              pence: price.trim() === "" ? null : Math.round(Number(price.replace("£", "")) * 100),
              checked: [...checked] as Tag[],
            }),
          "Saved. The list now links straight to it.",
        );
        if (ok) onDone();
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-body">
        <li>
          <a
            href={
              line.link.includes("/product/")
                ? `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(line.name)}`
                : line.link
            }
            target="_blank"
            rel="noreferrer noopener"
            className="text-mint underline"
          >
            Search Sainsbury&apos;s
          </a>{" "}
          and open the product you want.
        </li>
        <li>Copy its address from the share menu and paste it here.</li>
      </ol>
      <label className="block">
        <span className="field-label">Product link</span>
        <input
          className="field-input"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (e.target.value.includes("/product/")) fromSlug(e.target.value);
          }}
          placeholder="https://www.sainsburys.co.uk/gol-ui/product/…"
          required
        />
      </label>
      <label className="block">
        <span className="field-label">Name</span>
        <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={line.name} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-1 block">
          <span className="field-label">Pack</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />
        </label>
        <label className="col-span-1 block">
          <span className="field-label">Unit</span>
          <select className="field-input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="each">each</option>
          </select>
        </label>
        <label className="col-span-1 block">
          <span className="field-label">Price £</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="optional"
          />
        </label>
      </div>
      {line.allChecks.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="field-label">I read the label: it has no</legend>
          {line.allChecks.map((c) => (
            <label key={c.tag} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={checked.has(c.tag)}
                onChange={() =>
                  setChecked((s) => {
                    const n = new Set(s);
                    if (n.has(c.tag)) n.delete(c.tag);
                    else n.add(c.tag);
                    return n;
                  })
                }
                className="size-5 accent-mint"
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className="btn-life">
          Save product
        </button>
        {p && (
          <ActionButton
            action={async () => {
              const r = await removeProduct(line.item);
              if (!r.error) onDone();
              return r;
            }}
            className="btn-soft"
          >
            Forget it
          </ActionButton>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Fridge and freezer
// ---------------------------------------------------------------------------

export type CookSessionRow = {
  key: string;
  date: string;
  start: number;
  when: string;
  /** Where the Schedule has it. */
  time: number;
  due: boolean;
  note?: string;
  clash: boolean;
  /** Made from cook days already gone when the week was planned. */
  catchUp: boolean;
  cooks: { id: string; name: string; recipe: string; portions: number; freeze: number }[];
};

export function FridgeView({
  start,
  sessions,
  days,
  batches,
  recipes,
}: {
  start: string | null;
  sessions: CookSessionRow[];
  days: { date: string; label: string }[];
  batches: {
    gid: string;
    name: string;
    recipe: string;
    cooked: string;
    remaining: number;
    portions: number;
    location: "fridge" | "freezer";
    eatBy: string;
    late: boolean;
    soon: boolean;
    canFreeze: boolean;
    rice: boolean;
  }[];
  recipes: { key: string; name: string }[];
}) {
  const [extra, setExtra] = useState(false);
  const [rec, setRec] = useState(recipes[0]?.key ?? "");
  const [n, setN] = useState("4");
  const { pending, run } = useAction();
  return (
    <div className="space-y-4">
      {sessions.length > 0 && start && (
        <section className="space-y-2" aria-label="To cook">
          <h2 className="px-1 eyebrow">To cook this week</h2>
          {sessions.map((x) => (
            <CookSession key={x.key} start={start} session={x} days={days} />
          ))}
          <p className="px-1 text-xs text-faint">
            Cooked it takes the ingredients out of the cupboard and puts the portions in the fridge, the later ones in
            the freezer.
          </p>
        </section>
      )}

      <section className="space-y-2" aria-label="Cooked food">
        <h2 className="px-1 eyebrow">Cooked food</h2>
        {batches.length ? (
          <ul className="divide-y divide-white/5 card-life p-0">
            {batches.map((b) => (
              <li key={b.gid} className="space-y-2 p-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{b.name}</p>
                    <p className={`text-xs ${b.late ? "text-coral" : b.soon ? "text-sand" : "text-muted"}`}>
                      {b.location === "fridge" ? "Fridge" : "Freezer"} · cooked {b.cooked.toLowerCase()} ·{" "}
                      {b.late ? "past its fridge time: bin it" : `eat by ${b.eatBy.toLowerCase()}`}
                      {b.rice && b.location === "fridge" ? " (rice: one day)" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xl font-bold tabular-nums">
                    {b.remaining}
                    <span className="text-sm font-normal text-muted">/{b.portions}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={() => setBatch(b.gid, Math.max(0, b.remaining - 1), null)}
                    className="btn-soft px-3 py-1.5 text-xs"
                    label={`One less ${b.name}`}
                  >
                    − 1
                  </ActionButton>
                  <ActionButton
                    action={() => setBatch(b.gid, b.remaining + 1, null)}
                    className="btn-soft px-3 py-1.5 text-xs"
                    disabled={b.remaining >= b.portions}
                    label={`One more ${b.name}`}
                  >
                    + 1
                  </ActionButton>
                  {b.location === "fridge" && b.canFreeze && (
                    <ActionButton
                      action={() => setBatch(b.gid, null, "freezer")}
                      className="btn-soft px-3 py-1.5 text-xs"
                    >
                      Moved to freezer
                    </ActionButton>
                  )}
                  {b.location === "freezer" && (
                    <ActionButton
                      action={() => setBatch(b.gid, null, "fridge")}
                      className="btn-soft px-3 py-1.5 text-xs"
                    >
                      Moved to fridge
                    </ActionButton>
                  )}
                  <ActionButton
                    action={() => uncook(b.gid)}
                    className="px-3 py-1.5 text-xs text-faint hover:text-coral"
                    confirm={`Undo cooking ${b.name}? Its ingredients go back in the cupboard.`}
                  >
                    Undo cook
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-life text-sm text-muted">Nothing cooked yet. Tap Cooked it after a cook session.</p>
        )}
      </section>

      <section className="space-y-3 card-life">
        <button type="button" onClick={() => setExtra((x) => !x)} className="text-sm text-mint" aria-expanded={extra}>
          {extra ? "Never mind" : "Cooked something off the plan?"}
        </button>
        {extra && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => cookExtra(rec, Number(n)), "In the fridge.");
              if (ok) setExtra(false);
            }}
          >
            <label className="min-w-0 flex-1 basis-48">
              <span className="field-label">Recipe</span>
              <select className="field-input" value={rec} onChange={(e) => setRec(e.target.value)}>
                {recipes.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24">
              <span className="field-label">Portions</span>
              <input className="field-input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />
            </label>
            <button type="submit" disabled={pending} aria-busy={pending} className="btn-life">
              Add
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cupboard
// ---------------------------------------------------------------------------

export function CupboardView({
  rows,
}: {
  rows: {
    item: string;
    name: string;
    aisle: string;
    unit: Unit;
    staple: boolean;
    qty: number;
    amount: string | null;
    status: "have" | "low" | "out" | null;
    goodUntil: string | null;
    soon: boolean;
    known: boolean;
  }[];
}) {
  const [filter, setFilter] = useState<"have" | "staples" | "all">("have");
  const [edit, setEdit] = useState<(typeof rows)[number] | null>(null);
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "staples" ? r.staple : !r.staple && r.qty > 0,
  );
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-2xl bg-white/5 p-1" role="group" aria-label="Show">
        {(
          [
            ["have", "In stock"],
            ["staples", "Staples"],
            ["all", "Everything"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`min-h-10 flex-1 rounded-xl text-sm ${filter === k ? "bg-fern font-semibold" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {filter === "staples" && (
        <p className="px-1 text-xs text-muted">
          Staples aren&apos;t weighed. Mark one low or out and it goes on the next list.
        </p>
      )}
      {shown.length ? (
        <ul className="divide-y divide-white/5 card-life p-0">
          {shown.map((r) => (
            <li key={r.item} className="flex min-w-0 items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${r.soon ? "text-sand" : ""}`}>{r.name}</p>
                <p className="text-xs text-muted">
                  {r.staple
                    ? r.status === "have"
                      ? "Have it"
                      : r.status === "low"
                        ? "Running low"
                        : r.status === "out"
                          ? "Out"
                          : "Not checked"
                    : (r.amount ?? "None")}
                  {r.goodUntil ? ` · good until ${r.goodUntil.toLowerCase()}` : ""}
                  {r.soon ? " · use soon" : ""}
                </p>
              </div>
              {r.staple ? (
                <StapleToggle item={r.item} status={r.status} />
              ) : (
                <button type="button" onClick={() => setEdit(r)} className="btn-soft shrink-0 px-3 py-1.5 text-xs">
                  Edit
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-life text-sm text-muted">
          {filter === "have" ? "Nothing counted in yet. Confirming a delivery fills this in." : "Nothing here."}
        </p>
      )}
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit ? edit.name : ""}>
        {edit && <StockForm row={edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </div>
  );
}

function StapleToggle({ item, status }: { item: string; status: "have" | "low" | "out" | null }) {
  const { pending, run } = useAction();
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label="Stock">
      {(["have", "low", "out"] as const).map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          aria-busy={pending}
          aria-pressed={status === s}
          onClick={() => void run(() => setStock([{ item, status: s }], "set"))}
          className={`min-h-9 rounded-lg px-2.5 text-xs ${status === s ? (s === "have" ? "bg-mint text-primary" : s === "low" ? "bg-sand text-primary" : "bg-coral text-white") : "bg-white/5 text-muted"}`}
        >
          {s === "have" ? "Have" : s === "low" ? "Low" : "Out"}
        </button>
      ))}
    </div>
  );
}

function StockForm({ row, onDone }: { row: { item: string; unit: Unit; qty: number }; onDone: () => void }) {
  const [qty, setQty] = useState(String(Math.round(row.qty * 10) / 10));
  const { pending, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          () => setStock([{ item: row.item, qty: Math.max(0, Number(qty) || 0) }], "set"),
          "Updated.",
        );
        if (ok) onDone();
      }}
    >
      <label className="block">
        <span className="field-label">How much is left ({row.unit === "each" ? "count" : row.unit})</span>
        <input
          className="field-input text-lg"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className="btn-life">
          Save
        </button>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={async () =>
            (await run(() => setStock([{ item: row.item, qty: 0, good_until: null }], "set"), "Marked as used up.")) &&
            onDone()
          }
          className="btn-soft"
        >
          Used it up
        </button>
      </div>
    </form>
  );
}

/** One cook session: when the Schedule has it, why, what it makes, and a way to move it. */
function CookSession({
  start,
  session: x,
  days,
}: {
  start: string;
  session: CookSessionRow;
  days: { date: string; label: string }[];
}) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(x.date);
  const [time, setTime] = useState(clockOf(x.start));
  const { pending, run } = useAction();
  return (
    <div className="space-y-2 card-life p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {x.when} · {clockOf(x.time)}
          </p>
          {x.note && <p className={`text-xs ${x.clash ? "text-coral" : "text-muted"}`}>{x.note}</p>}
          {x.catchUp && (
            <p className="text-xs text-muted">
              Catch-up: this week was planned after its cook days had gone, so they became this one. Move it if the time
              doesn&apos;t work.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-soft px-3 py-1.5 text-xs"
          onClick={() => setMoving((m) => !m)}
          aria-expanded={moving}
        >
          {moving ? "Cancel" : "Move"}
        </button>
      </div>
      {moving && (
        <form
          className="flex flex-wrap items-end gap-2 px-3"
          onSubmit={(e) => {
            e.preventDefault();
            const [h, m] = time.split(":").map(Number);
            void run(
              () => moveCookSession(start, { date: x.date, at: x.start }, { date, at: h * 60 + m }),
              "Moved. The Schedule and your calendar follow.",
            ).then((ok) => ok && setMoving(false));
          }}
        >
          <label className="text-xs text-muted">
            Day
            <select
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block rounded-lg bg-white/5 p-2 text-sm text-white ring-1 ring-white/10"
            >
              {days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Time
            <input
              type="time"
              value={time}
              min="06:00"
              max="22:00"
              step={900}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 block rounded-lg bg-white/5 p-2 text-sm text-white ring-1 ring-white/10"
            />
          </label>
          <button className="btn-life px-4 py-2" disabled={pending} aria-busy={pending}>
            Move
          </button>
        </form>
      )}
      <ul className="divide-y divide-white/5">
        {x.cooks.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted">
                {c.portions} portions{c.freeze ? `, ${c.freeze} to freeze` : ""}
              </p>
            </div>
            <ActionButton
              action={() => cookPlanned(start, c.id)}
              className={x.due ? "btn-life px-4 py-2" : "btn-soft"}
              done={c.freeze ? `In the fridge. Freeze ${c.freeze} once cool.` : "In the fridge."}
            >
              Cooked it
            </ActionButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

function clockOf(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
