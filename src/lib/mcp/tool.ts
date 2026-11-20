// What a Claude tool is, for every module that offers some (the connector, and the
// Life, Money and tutor domains), and the check of a call against what the tool
// said it takes. It sits below the domains (docs/ARCHITECTURE.md), so they can
// share it without depending on the connector. Pure, so it is tested.
//
// The MCP specification asks servers to validate every tool input, and to answer a
// bad one as a tool result with isError, so the model can correct itself and call
// again. checkArgs is that check: the route runs it before any tool runs, and the
// message names the field and what was expected.

export type Json = Record<string, unknown>;

export type ToolResult = { text: string; isError?: boolean };

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Json, ctx: { base: string }) => Promise<ToolResult>;
};

export const ok = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 1) });
export const err = (message: string): ToolResult => ({ text: message, isError: true });

/**
 * The JSON Schema keywords checkArgs understands. A tool's schema may use no
 * others: one it doesn't know would be a rule the tool states and nobody checks.
 * e2e/state-connector.spec.ts holds every tool to this list.
 */
export const KEYWORDS = [
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "items",
  "minItems",
  "maxItems",
  "anyOf",
] as const;

const TYPES = ["string", "integer", "number", "boolean", "array", "object", "null"];

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const types = (schema: Json): string[] =>
  typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type.map(String) : [];

/** Every place a schema uses a keyword or a type the checker doesn't know, as "where: what". */
export function unsupported(schema: unknown, at = "the schema"): string[] {
  if (!isObject(schema)) return [`${at}: not an object`];
  const found: string[] = [];
  for (const key of Object.keys(schema))
    if (!(KEYWORDS as readonly string[]).includes(key)) found.push(`${at}: ${key}`);
  for (const t of types(schema)) if (!TYPES.includes(t)) found.push(`${at}: type ${t}`);
  // Only a closed object is checked for stray fields; anything else under this keyword would be ignored.
  if ("additionalProperties" in schema && schema.additionalProperties !== false)
    found.push(`${at}: additionalProperties other than false`);
  if (isObject(schema.properties))
    for (const [name, sub] of Object.entries(schema.properties)) found.push(...unsupported(sub, name));
  if ("items" in schema) found.push(...unsupported(schema.items, `${at}[]`));
  if (Array.isArray(schema.anyOf))
    schema.anyOf.forEach((sub, i) => found.push(...unsupported(sub, `${at} (choice ${i + 1})`)));
  return found;
}

const allowsNull = (schema: Json): boolean =>
  types(schema).includes("null") ||
  (Array.isArray(schema.anyOf) && schema.anyOf.some((s) => isObject(s) && allowsNull(s)));

/** A short description of the bad value, safe to send back: its kind, and the value itself only when it is short. */
function got(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  const text = JSON.stringify(value) ?? String(value);
  const shown = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return typeof value === "string" ? `the text ${shown}` : shown;
}

const range = (lo: unknown, hi: unknown, unit = "") =>
  typeof lo === "number" && typeof hi === "number"
    ? lo === hi
      ? ` of ${lo}${unit}`
      : ` from ${lo} to ${hi}${unit}`
    : typeof lo === "number"
      ? ` from ${lo}${unit}`
      : typeof hi === "number"
        ? ` up to ${hi}${unit}`
        : "";

/** What a schema asks for, in a few words: "a whole number from 15 to 720". */
function wanted(schema: Json): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  if (Array.isArray(schema.anyOf))
    return schema.anyOf
      .filter(isObject)
      .map((s) => wanted(s))
      .join(", or ");
  const parts = types(schema).map((t) => {
    switch (t) {
      case "integer":
        return `a whole number${range(schema.minimum, schema.maximum)}`;
      case "number":
        return `a number${range(schema.minimum, schema.maximum)}`;
      case "string":
        return `text${range(schema.minLength, schema.maxLength, " characters")}${
          typeof schema.pattern === "string" ? ` matching ${schema.pattern}` : ""
        }`;
      case "boolean":
        return "true or false";
      case "array":
        return `a list${range(schema.minItems, schema.maxItems, " items")}`;
      case "object":
        return "an object";
      default:
        return t;
    }
  });
  return parts.length ? parts.join(" or ") : "a value";
}

/** The tool's own words about the field, when it has some: the first sentence, so the model has an example to copy. */
function hint(schema: Json): string {
  if (typeof schema.description !== "string") return "";
  const first = /^.*?[.!?](?=\s|$)/.exec(schema.description)?.[0] ?? schema.description;
  return first.length <= 160 ? ` (${first})` : "";
}

const wrong = (at: string, schema: Json, value: unknown) =>
  `${at} must be ${wanted(schema)}, not ${got(value)}.${hint(schema)}`;

function check(schema: Json, value: unknown, at: string): string | null {
  if (Array.isArray(schema.anyOf)) {
    const choices = schema.anyOf.filter(isObject);
    if (!choices.some((s) => check(s, value, at) === null)) return wrong(at, schema, value);
  }
  const allowed = types(schema);
  if (allowed.length) {
    const fits = allowed.some((t) => {
      switch (t) {
        case "string":
          return typeof value === "string";
        case "integer":
          return typeof value === "number" && Number.isInteger(value);
        case "number":
          return typeof value === "number" && Number.isFinite(value);
        case "boolean":
          return typeof value === "boolean";
        case "array":
          return Array.isArray(value);
        case "object":
          return isObject(value);
        case "null":
          return value === null;
        default:
          return false;
      }
    });
    if (!fits) return wrong(at, schema, value);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return wrong(at, schema, value);
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return wrong(at, schema, value);
    if (typeof schema.maximum === "number" && value > schema.maximum) return wrong(at, schema, value);
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) return wrong(at, schema, value);
    if (typeof schema.maxLength === "number" && length > schema.maxLength) return wrong(at, schema, value);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return wrong(at, schema, value);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return wrong(at, schema, value);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return wrong(at, schema, value);
    if (isObject(schema.items))
      for (const [i, item] of value.entries()) {
        const problem = check(schema.items, item, `${at}[${i}]`);
        if (problem) return problem;
      }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const inside = (name: string) => (at ? `${at}.${name}` : name);
    for (const name of Array.isArray(schema.required) ? schema.required.map(String) : []) {
      const sub = isObject(properties[name]) ? properties[name] : {};
      // A null is a field left out, unless the tool says null means something.
      if (value[name] === undefined || (value[name] === null && !allowsNull(sub)))
        return `${inside(name)} is required: ${wanted(sub)}.${hint(sub)}`;
    }
    for (const [name, given] of Object.entries(value)) {
      const sub = properties[name];
      if (!isObject(sub)) {
        if (schema.additionalProperties !== false) continue;
        const takes = Object.keys(properties);
        return `${inside(name)} is not something this tool takes. It takes ${takes.length ? takes.join(", ") : "nothing"}.`;
      }
      if (given === undefined || (given === null && !allowsNull(sub))) continue;
      const problem = check(sub, given, inside(name));
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * The first thing wrong with a tool call's arguments, as a sentence the model can
 * act on, or null when they fit the tool's schema.
 */
export function checkArgs(schema: Json, args: unknown): string | null {
  if (!isObject(args)) return `The arguments must be an object of named values, not ${got(args)}.`;
  return check(schema, args, "");
}

function strip(schema: Json, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = schema.items;
    return isObject(items) ? value.map((v) => strip(items, v)) : value;
  }
  if (!isObject(value)) return value;
  const properties = isObject(schema.properties) ? schema.properties : {};
  const kept: Json = {};
  for (const [name, given] of Object.entries(value)) {
    const sub = properties[name];
    if (!isObject(sub)) kept[name] = given;
    else if (given !== null || allowsNull(sub)) kept[name] = strip(sub, given);
  }
  return kept;
}

/**
 * The arguments as a tool should see them: a null is a field left out, unless the
 * tool's schema says null means something (clearing a budget, say). For after
 * checkArgs has passed, so no tool turns a stray null into a zero.
 */
export function withoutNulls(schema: Json, args: Json): Json {
  return strip(schema, args) as Json;
}
