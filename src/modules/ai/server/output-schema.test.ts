import { describe, expect, it } from "vitest";

import { outputSchemas } from "../domain";
import { normalizeEnumCase, structuredOutputSchema } from "./output-schema";

/** Keywords the structured-output API documents as unsupported (a 400 if sent). */
const UNSUPPORTED = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
  "uniqueItems",
  "oneOf",
  "not",
  "patternProperties",
];

function nodes(json: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(json)) json.forEach((n) => nodes(n, out));
  else if (json && typeof json === "object") {
    out.push(json as Record<string, unknown>);
    Object.values(json).forEach((n) => nodes(n, out));
  }
  return out;
}

describe("structured-output schema (M11.1)", () => {
  it.each(Object.keys(outputSchemas))("%s uses only documented, supported keywords", (cap) => {
    const schema = structuredOutputSchema(outputSchemas[cap as keyof typeof outputSchemas]);
    for (const node of nodes(schema)) {
      for (const key of UNSUPPORTED) expect(Object.keys(node), `${cap}: ${key}`).not.toContain(key);
      if (node.type === "object") expect(node.additionalProperties).toBe(false);
      if ("minItems" in node) expect([0, 1]).toContain(node.minItems);
    }
  });

  it("keeps enum and const, which the SDK helper would reduce to descriptions", () => {
    const schema = JSON.stringify(structuredOutputSchema(outputSchemas.automation_rule));
    expect(schema).toContain('"const":"task.completed"');
    expect(schema).toContain('"const":"create_follow_up_task"');
    expect(schema).toContain('"const":"daily"');
  });
});

describe("enum capitalisation", () => {
  const rec = {
    taskId: "t",
    action: "Do_Now",
    reason: "Low",
    benefit: "b",
    uncertainty: "LOW",
    nextStep: null,
    suggestedPriority: null,
  };

  it("maps enum values that differ only in case, and never touches free text", () => {
    const fixed = normalizeEnumCase(outputSchemas.priorities, {
      recommendations: [rec],
      notes: ["Medium"],
    }) as { recommendations: (typeof rec)[]; notes: string[] };
    expect(fixed.recommendations[0]).toMatchObject({
      action: "do_now",
      uncertainty: "low",
      reason: "Low",
    });
    expect(fixed.notes).toEqual(["Medium"]);
    expect(outputSchemas.priorities.safeParse(fixed).success).toBe(true);
  });

  it("leaves unknown values for strict validation to reject", () => {
    const fixed = normalizeEnumCase(outputSchemas.priorities, {
      recommendations: [{ ...rec, action: "delete_everything" }],
      notes: [],
    });
    expect(outputSchemas.priorities.safeParse(fixed).success).toBe(false);
  });

  it("covers enum arrays and discriminators", () => {
    const fixed = normalizeEnumCase(outputSchemas.question, {
      answer: "a",
      basedOn: ["Tasks", "FINANCE"],
      dataGaps: [],
    });
    expect(fixed).toMatchObject({ basedOn: ["tasks", "finance"] });
    const rule = normalizeEnumCase(outputSchemas.automation_rule, {
      supported: true,
      explanation: "e",
      unsupportedReasons: [],
      rule: {
        name: "n",
        description: null,
        trigger: { type: "Task.Completed" },
        conditions: [],
        actions: [{ type: "Notify", title: "t", body: null }],
      },
    });
    expect(outputSchemas.automation_rule.safeParse(rule).success).toBe(true);
  });
});
