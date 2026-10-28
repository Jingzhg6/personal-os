import { describe, expect, it } from "vitest";

import {
  applyProposalInput,
  automationDraftOutput,
  changeTarget,
  factsForModel,
  generateInput,
  goalPlanOutput,
  prioritiesOutput,
  proposalChange,
  staleRefs,
  taskFacts,
  type ReviewFacts,
} from "./index";

const id = () => crypto.randomUUID();

describe("model output schemas", () => {
  it("reject unknown keys, wrong types and oversize text", () => {
    const rec = {
      taskId: "t1",
      action: "do_now",
      reason: "r",
      benefit: "b",
      uncertainty: "low",
      nextStep: null,
      suggestedPriority: null,
    };
    expect(prioritiesOutput.safeParse({ recommendations: [rec], notes: [] }).success).toBe(true);
    expect(
      prioritiesOutput.safeParse({ recommendations: [{ ...rec, sql: "drop" }], notes: [] }).success,
    ).toBe(false);
    expect(
      prioritiesOutput.safeParse({ recommendations: [{ ...rec, action: "delete" }], notes: [] })
        .success,
    ).toBe(false);
    expect(
      prioritiesOutput.safeParse({
        recommendations: [{ ...rec, reason: "x".repeat(401) }],
        notes: [],
      }).success,
    ).toBe(false);
    expect(
      prioritiesOutput.safeParse({ recommendations: [{ ...rec, suggestedPriority: 9 }], notes: [] })
        .success,
    ).toBe(false);
  });

  it("bound plans and keep dates relative", () => {
    const task = {
      title: "t",
      stepIndex: 0,
      dueInDays: 3,
      estimatedMinutes: 30,
      contributions: [],
    };
    const plan = {
      summary: "s",
      steps: [{ title: "a", rationale: "b" }],
      tasks: [task],
      assumptions: [],
    };
    expect(goalPlanOutput.safeParse(plan).success).toBe(true);
    expect(goalPlanOutput.safeParse({ ...plan, tasks: Array(11).fill(task) }).success).toBe(false);
    expect(
      goalPlanOutput.safeParse({ ...plan, tasks: [{ ...task, dueDate: "2026-01-01" }] }).success,
    ).toBe(false);
  });

  it("only accept the automation engine's own triggers and actions", () => {
    const draft = {
      supported: true,
      explanation: "e",
      unsupportedReasons: [],
      rule: {
        name: "n",
        description: null,
        trigger: { type: "task.completed" },
        conditions: [],
        actions: [{ type: "notify", title: "t", body: null }],
      },
    };
    expect(automationDraftOutput.safeParse(draft).success).toBe(true);
    expect(
      automationDraftOutput.safeParse({
        ...draft,
        rule: { ...draft.rule, actions: [{ type: "webhook", url: "https://x" }] },
      }).success,
    ).toBe(false);
    expect(
      automationDraftOutput.safeParse({
        ...draft,
        rule: { ...draft.rule, trigger: { type: "xp.awarded" } },
      }).success,
    ).toBe(false);
  });
});

describe("proposal changes", () => {
  it("are an explicit allow-list", () => {
    expect(
      proposalChange.safeParse({ type: "set_task_priority", taskId: id(), priority: 3 }).success,
    ).toBe(true);
    for (const type of ["set_xp", "delete_task", "save_snapshot", "set_rule_enabled"]) {
      expect(proposalChange.safeParse({ type, taskId: id() }).success).toBe(false);
    }
  });

  it("identify their target, so edits cannot redirect them", () => {
    const taskId = id();
    expect(changeTarget({ type: "set_task_priority", taskId, priority: 1 })).toBe(
      changeTarget({ type: "set_task_priority", taskId, priority: 4 }),
    );
    expect(changeTarget({ type: "set_task_priority", taskId, priority: 1 })).not.toBe(
      changeTarget({ type: "set_task_priority", taskId: id(), priority: 1 }),
    );
  });

  it("need an explicit confirmation to apply", () => {
    const items = [{ key: "p0", change: { type: "set_task_priority", taskId: id(), priority: 2 } }];
    expect(applyProposalInput.safeParse({ id: id(), confirm: true, items }).success).toBe(true);
    expect(applyProposalInput.safeParse({ id: id(), confirm: false, items }).success).toBe(false);
    expect(applyProposalInput.safeParse({ id: id(), items }).success).toBe(false);
    expect(applyProposalInput.safeParse({ id: id(), confirm: true, items: [] }).success).toBe(
      false,
    );
  });

  it("are stale when a source entity changed or disappeared", () => {
    const refs = [
      { type: "task" as const, id: "a", version: "v1" },
      { type: "goal" as const, id: "b", version: "v1" },
    ];
    expect(
      staleRefs(
        refs,
        new Map([
          ["task:a", "v1"],
          ["goal:b", "v1"],
        ]),
      ),
    ).toEqual([]);
    expect(
      staleRefs(
        refs,
        new Map([
          ["task:a", "v2"],
          ["goal:b", "v1"],
        ]),
      ),
    ).toEqual([refs[0]]);
    expect(staleRefs(refs, new Map([["task:a", "v1"]]))).toEqual([refs[1]]);
  });
});

describe("requests", () => {
  it("bound free text", () => {
    expect(
      generateInput.safeParse({ capability: "question", question: "x".repeat(1000) }).success,
    ).toBe(true);
    expect(
      generateInput.safeParse({ capability: "question", question: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(generateInput.safeParse({ capability: "question", question: "  " }).success).toBe(false);
    expect(generateInput.safeParse({ capability: "review", userId: id() }).success).toBe(false);
  });
});

describe("review facts", () => {
  it("count open, overdue, blocked and urgent-important tasks", () => {
    const base = { openBlockerCount: 0, isUrgent: null, isImportant: null };
    const facts = taskFacts(
      [
        { ...base, id: "1", title: "a", statusCategory: "unstarted", dueDate: "2026-10-01" },
        {
          ...base,
          id: "2",
          title: "b",
          statusCategory: "started",
          dueDate: "2026-10-28",
          openBlockerCount: 1,
        },
        { ...base, id: "3", title: "c", statusCategory: "completed", dueDate: "2026-10-01" },
        {
          ...base,
          id: "4",
          title: "d",
          statusCategory: "backlog",
          dueDate: null,
          isUrgent: true,
          isImportant: true,
        },
      ],
      "2026-10-28",
    );
    expect(facts).toEqual({
      open: 3,
      overdue: 1,
      dueToday: 1,
      blocked: 1,
      urgentImportant: 1,
      overdueItems: [{ id: "1", title: "a", dueDate: "2026-10-01" }],
    });
  });

  it("send finance to a model as completeness counts only", () => {
    const facts = {
      finance: {
        hasAccounts: true,
        lastValuationDate: "2026-10-01",
        missing: [{ accountId: "a", name: "定期" }],
        stale: [{ accountId: "b", name: "活期", valuationDate: "2026-01-01" }],
        unconverted: [],
      },
    } as unknown as ReviewFacts;
    expect(factsForModel(facts).finance).toEqual({
      hasAccounts: true,
      lastValuationDate: "2026-10-01",
      accountsWithoutValuation: 1,
      staleValuations: 1,
      valuationsWithoutExchangeRate: 0,
    });
    expect(JSON.stringify(factsForModel(facts))).not.toMatch(/定期|活期/);
  });
});
