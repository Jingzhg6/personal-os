import { describe, expect, it } from "vitest";

import {
  actionsFor,
  classifyError,
  conditionsFor,
  evaluateConditions,
  executionStatusOf,
  LIMITS,
  localDate,
  MISFIRE_GRACE_MS,
  nextOccurrence,
  parseStoredRule,
  planDue,
  renderTemplate,
  ruleConfigSchema,
  triggerKey,
  zonedInstant,
  type Facts,
  type RuleConfigInput,
} from "./index";

const uuid = () => crypto.randomUUID();
const task: Facts = {
  kind: "task",
  taskId: uuid(),
  title: "写周报",
  priority: 3,
  areaId: "11111111-1111-4111-8111-111111111111",
  projectId: null,
  statusId: "22222222-2222-4222-8222-222222222222",
};

const rule = (overrides: Partial<RuleConfigInput> = {}): RuleConfigInput => ({
  name: "完成后跟进",
  trigger: { type: "task.completed" },
  actions: [{ type: "create_follow_up_task", title: "跟进：{task}" }],
  ...overrides,
});

describe("rule configuration", () => {
  it("accepts typed triggers, conditions and actions and fills defaults", () => {
    const parsed = ruleConfigSchema.parse(
      rule({ conditions: [{ type: "task_priority", priority: 3 }] }),
    );
    expect(parsed.actions[0]).toEqual({
      type: "create_follow_up_task",
      title: "跟进：{task}",
      description: null,
      priority: 0,
      dueInDays: null,
    });
    expect(parsed.description).toBeNull();
  });

  it("rejects unknown triggers, fields, malformed schedules and time zones", () => {
    const bad: unknown[] = [
      rule({ trigger: { type: "task.deleted" } as never }),
      rule({ trigger: { type: "task.completed", extra: 1 } as never }),
      rule({ trigger: { type: "schedule", schedule: { kind: "daily", time: "25:00" } } }),
      rule({
        trigger: {
          type: "schedule",
          schedule: { kind: "once", date: "2026-02-30", time: "09:00" },
        },
      }),
      rule({
        trigger: {
          type: "schedule",
          schedule: { kind: "weekly", weekdays: [1, 1], time: "09:00" },
        },
      }),
      rule({
        trigger: { type: "schedule", schedule: { kind: "cron", expr: "* * * * *" } as never },
      }),
      rule({ timeZone: "Mars/Olympus" }),
      rule({ actions: [{ type: "run_sql", sql: "drop table tasks" } as never] }),
      rule({ actions: [{ type: "notify", title: "x", script: "alert(1)" } as never] }),
      rule({ actions: [] }),
      rule({ actions: Array(LIMITS.actions + 1).fill({ type: "notify", title: "x" }) }),
    ];
    for (const input of bad) expect(ruleConfigSchema.safeParse(input).success).toBe(false);
  });

  it("only allows conditions and actions that fit the trigger", () => {
    expect(conditionsFor("project.completed")).toEqual(["project_priority", "project_area"]);
    expect(actionsFor("finance.snapshot_saved")).toEqual(["create_task", "notify"]);
    expect(actionsFor("schedule")).not.toContain("set_task_priority");
    expect(
      ruleConfigSchema.safeParse(
        rule({
          trigger: { type: "finance.snapshot_saved" },
          conditions: [{ type: "task_priority", priority: 1 }],
        }),
      ).success,
    ).toBe(false);
    expect(
      ruleConfigSchema.safeParse(
        rule({
          trigger: { type: "goal.status_changed" },
          actions: [{ type: "set_task_priority", priority: 4 }],
        }),
      ).success,
    ).toBe(false);
  });

  it("treats invalid persisted configuration as data, never executing it", () => {
    const stored = {
      name: "旧规则",
      description: null,
      trigger: { type: "task.completed" },
      conditions: [{ type: "javascript", code: "process.exit()" }],
      actions: [{ type: "create_task", title: "x" }],
      timeZone: null,
    };
    expect(parseStoredRule(stored).ok).toBe(false);
    expect(parseStoredRule({ ...stored, conditions: [] }).ok).toBe(true);
  });
});

describe("conditions", () => {
  it("matches all conditions (AND) against captured facts", () => {
    expect(evaluateConditions([], task).matched).toBe(true);
    const result = evaluateConditions(
      [
        { type: "task_priority", priority: 3 },
        { type: "task_area", areaId: "11111111-1111-4111-8111-111111111111" },
        { type: "task_project", projectId: uuid() },
      ],
      task,
    );
    expect(result.matched).toBe(false);
    expect(result.results.map((r) => r.matched)).toEqual([true, true, false]);
  });

  it("never matches a condition meant for other facts", () => {
    expect(evaluateConditions([{ type: "goal_status", status: "completed" }], task).matched).toBe(
      false,
    );
    const finance: Facts = {
      kind: "finance",
      valuationDate: "2026-10-01",
      entryCount: 3,
      unconvertedCount: 1,
      corrected: false,
    };
    expect(evaluateConditions([{ type: "finance_all_valued" }], finance).matched).toBe(false);
    expect(
      evaluateConditions([{ type: "finance_all_valued" }], { ...finance, unconvertedCount: 0 })
        .matched,
    ).toBe(true);
  });
});

describe("templates", () => {
  it("replaces only the allowlisted placeholders", () => {
    expect(renderTemplate("跟进：{task}（{date}）{goal}{constructor}", task, "2026-10-27")).toBe(
      "跟进：写周报（2026-10-27）{constructor}",
    );
  });
});

describe("idempotency keys", () => {
  it("are stable per logical occurrence", () => {
    expect(triggerKey("task.completed", { eventId: uuid(), facts: task })).toBe(
      triggerKey("task.completed", { eventId: uuid(), facts: task }),
    );
    const a = triggerKey("task.status_changed", { eventId: "e1", facts: task });
    const b = triggerKey("task.status_changed", { eventId: "e2", facts: task });
    expect(a).not.toBe(b);
    expect(
      triggerKey("schedule", {
        facts: {
          kind: "schedule",
          scheduledFor: "2026-10-27T08:00:00.000Z",
          localDate: "2026-10-27",
        },
      }),
    ).toBe("schedule:2026-10-27T08:00:00.000Z");
  });
});

describe("failures", () => {
  it("classifies business-rule refusals as permanent and the rest as transient", () => {
    expect(classifyError({ kind: "not_found", code: "project.not_found" })).toEqual({
      code: "project.not_found",
      retryable: false,
    });
    expect(classifyError(new Error("connection reset"))).toEqual({
      code: "automation.transient",
      retryable: true,
    });
  });

  it("derives the execution status from per-action outcomes", () => {
    expect(executionStatusOf([{ index: 0, type: "notify", outcome: "succeeded" }])).toBe(
      "succeeded",
    );
    expect(
      executionStatusOf([
        { index: 0, type: "notify", outcome: "succeeded" },
        { index: 1, type: "create_task", outcome: "failed" },
        { index: 2, type: "notify", outcome: "not_run" },
      ]),
    ).toBe("partial");
    expect(executionStatusOf([{ index: 0, type: "notify", outcome: "failed" }])).toBe("failed");
  });
});

/* ---------------------------------------------------------------- schedules */

const PARIS = "Europe/Paris";
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("time zones and daylight saving", () => {
  it("resolves ordinary local times", () => {
    expect(iso(zonedInstant("2026-07-01", "09:00", PARIS).instant)).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(iso(zonedInstant("2026-12-01", "09:00", PARIS).instant)).toBe(
      "2026-12-01T08:00:00.000Z",
    );
    expect(iso(zonedInstant("2026-12-01", "09:00", "Asia/Shanghai").instant)).toBe(
      "2026-12-01T01:00:00.000Z",
    );
  });

  it("moves a nonexistent time (spring-forward gap) forward by the gap", () => {
    // 2026-03-29 in Paris: 02:00 → 03:00.
    const gap = zonedInstant("2026-03-29", "02:30", PARIS);
    expect(gap.resolution).toBe("gap");
    expect(iso(gap.instant)).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST
  });

  it("runs a repeated time (fall-back overlap) once, at its first occurrence", () => {
    // 2026-10-25 in Paris: 03:00 → 02:00, so 02:30 happens twice.
    const overlap = zonedInstant("2026-10-25", "02:30", PARIS);
    expect(overlap.resolution).toBe("overlap");
    expect(iso(overlap.instant)).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST
    const daily = { kind: "daily", time: "02:30" } as const;
    const first = nextOccurrence(daily, PARIS, Date.parse("2026-10-24T12:00:00Z"));
    const second = nextOccurrence(daily, PARIS, first!);
    expect([iso(first), iso(second)]).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ]);
  });

  it("computes the next daily, weekly and monthly occurrences in the zone", () => {
    const after = Date.parse("2026-10-27T10:00:00Z"); // Tuesday, 11:00 in Paris
    expect(iso(nextOccurrence({ kind: "daily", time: "09:00" }, PARIS, after))).toBe(
      "2026-10-28T08:00:00.000Z",
    );
    expect(iso(nextOccurrence({ kind: "daily", time: "12:00" }, PARIS, after))).toBe(
      "2026-10-27T11:00:00.000Z",
    );
    expect(
      iso(nextOccurrence({ kind: "weekly", weekdays: [1, 5], time: "08:00" }, PARIS, after)),
    ).toBe("2026-10-30T07:00:00.000Z");
    // Day 31 runs on the last day of shorter months.
    expect(iso(nextOccurrence({ kind: "monthly", day: 31, time: "20:00" }, PARIS, after))).toBe(
      "2026-10-31T19:00:00.000Z",
    );
    expect(
      iso(
        nextOccurrence(
          { kind: "monthly", day: 31, time: "20:00" },
          PARIS,
          Date.parse("2026-11-01T00:00:00Z"),
        ),
      ),
    ).toBe("2026-11-30T19:00:00.000Z");
    expect(
      nextOccurrence({ kind: "once", date: "2026-10-01", time: "09:00" }, PARIS, after),
    ).toBeNull();
    expect(localDate(Date.parse("2026-10-27T23:30:00Z"), "Asia/Shanghai")).toBe("2026-10-28");
  });
});

describe("misfire policy", () => {
  const daily = { kind: "daily", time: "09:00" } as const;
  const due = Date.parse("2026-10-20T07:00:00Z"); // 09:00 Paris

  it("runs a due occurrence once and continues with the next", () => {
    const plan = planDue(daily, PARIS, due, due + 60_000);
    expect(plan).toMatchObject({ run: due, skipped: 0 });
    expect(iso(plan.next)).toBe("2026-10-21T07:00:00.000Z");
  });

  it("coalesces missed occurrences into the latest when within the grace period", () => {
    // Worker down for a week, back 1 h after the latest occurrence.
    const latest = Date.parse("2026-10-27T08:00:00Z"); // 09:00 CET (after the DST change)
    const plan = planDue(daily, PARIS, due, latest + 3_600_000);
    expect(iso(plan.run)).toBe(iso(latest));
    expect(plan.skipped).toBe(7);
  });

  it("skips (records) an occurrence missed by more than the grace period", () => {
    const plan = planDue(daily, PARIS, due, due + MISFIRE_GRACE_MS + 60_000);
    expect(plan.run).toBeNull();
    expect(plan.skipped).toBe(1);
    expect(plan.latest).toBe(due);
  });
});
