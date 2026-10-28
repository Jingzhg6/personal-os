import "server-only";

import { z } from "zod";

/*
 * The JSON schema sent as the structured-output format.
 *
 * The SDK's `zodOutputFormat` (v1.3.0) keeps only `type`, `format` and `minItems` ≤ 1, and folds
 * every other keyword into the description — including `enum` and `const`, which the API does
 * enforce. Our closed value sets (areas, actions, uncertainty, trigger / condition / action types)
 * would then only be hints. This transform follows the same rules but keeps `enum` and `const`, so
 * the model is constrained to them. Everything else (lengths, ranges) stays a description hint and
 * is enforced by the app's own zod validation of the output, which always runs.
 */

const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

type Json = Record<string, unknown>;

function transform(input: Json): Json {
  const node: Json = { ...input };
  const out: Json = {};
  const take = (key: string) => {
    const value = node[key];
    delete node[key];
    return value;
  };

  const defs = take("$defs") as Record<string, Json> | undefined;
  if (defs) {
    out.$defs = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, transform(v)]));
  }
  const ref = take("$ref");
  if (ref !== undefined) {
    out.$ref = ref;
    return out;
  }
  take("$schema");
  const type = take("type");
  const anyOf = (take("anyOf") ?? take("oneOf")) as Json[] | undefined;
  const allOf = take("allOf") as Json[] | undefined;
  if (anyOf) out.anyOf = anyOf.map(transform);
  else if (allOf) out.allOf = allOf.map(transform);
  else if (type !== undefined) out.type = type;

  const description = take("description");
  const enumValues = take("enum");
  const constValue = take("const");
  if (enumValues !== undefined) out.enum = enumValues;
  if (constValue !== undefined) out.const = constValue;

  if (type === "object") {
    const properties = (take("properties") ?? {}) as Record<string, Json>;
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, transform(v)]),
    );
    take("additionalProperties");
    out.additionalProperties = false;
    const required = take("required");
    if (required !== undefined) out.required = required;
  } else if (type === "string") {
    const format = take("format");
    if (typeof format === "string" && SUPPORTED_FORMATS.has(format)) out.format = format;
    else if (format !== undefined) node.format = format;
  } else if (type === "array") {
    const items = take("items") as Json | undefined;
    if (items) out.items = transform(items);
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) node.minItems = minItems;
  }

  // Remaining constraints become a hint; the app validates them on the output.
  const hints = Object.entries(node).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  if (description !== undefined || hints.length > 0) {
    out.description = [description, hints.length > 0 ? `{${hints.join(", ")}}` : null]
      .filter(Boolean)
      .join("\n\n");
  }
  return out;
}

export function structuredOutputSchema(schema: z.ZodType): Json {
  return transform(z.toJSONSchema(schema, { reused: "ref" }) as Json);
}

/** Property name → its allowed enum / const string values (from every object in the schema). */
function enumFields(json: Json): Map<string, Set<string>> {
  const fields = new Map<string, Set<string>>();
  const valuesOf = (node: Json | undefined): string[] => {
    if (!node) return [];
    const own = [...((node.enum as unknown[]) ?? []), node.const].filter(
      (v): v is string => typeof v === "string",
    );
    const items = node.items as Json | undefined;
    return [...own, ...(items ? valuesOf(items) : [])];
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as Json;
    for (const [key, value] of Object.entries((n.properties ?? {}) as Record<string, Json>)) {
      const values = valuesOf(value);
      if (values.length > 0) {
        const set = fields.get(key) ?? new Set<string>();
        values.forEach((v) => set.add(v));
        fields.set(key, set);
      }
    }
    Object.values(n).forEach(walk);
  };
  walk(json);
  return fields;
}

/**
 * Structured outputs do not guarantee the capitalisation of `enum` / `const` values (documented by
 * the provider). Before strict validation, a value of an enum-typed field that differs from an
 * allowed value only in case is mapped to it. Only fields declared as enums are touched — free
 * text (titles, reasons) never is — and anything else still fails validation.
 */
export function normalizeEnumCase(schema: z.ZodType, raw: unknown): unknown {
  const fields = enumFields(z.toJSONSchema(schema) as Json);
  const fix = (key: string, value: unknown): unknown => {
    const allowed = fields.get(key);
    if (!allowed) return visit(value);
    const one = (v: unknown) => {
      if (typeof v !== "string" || allowed.has(v)) return visit(v);
      const match = [...allowed].filter((a) => a.toLowerCase() === v.toLowerCase());
      return match.length === 1 ? match[0] : v;
    };
    return Array.isArray(value) ? value.map(one) : one(value);
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fix(k, v)]));
  };
  return visit(raw);
}
