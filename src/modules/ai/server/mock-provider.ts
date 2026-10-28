import "server-only";

import type { AiErrorCode } from "../domain";
import type { GenerateRequest, GenerateResult } from "./provider";

/*
 * The deterministic test provider (AI_PROVIDER=mock). It derives its answers mechanically from the
 * context it receives — it is not AI, and the UI labels its output 模拟. It exists so the advisory
 * flow (validation, proposals, approvals) can be tested without paid calls.
 *
 * Failure modes for tests: free text containing [mock:timeout], [mock:rate_limited],
 * [mock:error], [mock:malformed] or [mock:foreign] makes it fail accordingly.
 */

const FAILURES: Record<string, AiErrorCode> = {
  "[mock:timeout]": "ai.timeout",
  "[mock:rate_limited]": "ai.rate_limited",
  "[mock:error]": "ai.provider_error",
  "[mock:refused]": "ai.refused",
};

/** An id that belongs to nobody in the request (stands in for another user's entity). */
export const FOREIGN_ID = "00000000-0000-7000-8000-000000000000";

type Data = Record<string, unknown>;
interface CtxTask {
  id: string;
  title: string;
  priority: number;
  dueDate: string | null;
  openBlockers: number;
  growsFocusAttribute: boolean;
  urgent: boolean | null;
  important: boolean | null;
}
interface Attr {
  id: string;
  name: string;
}

const ok = (raw: unknown): GenerateResult => ({
  ok: true,
  raw,
  usage: { inputTokens: null, outputTokens: null },
});

export function mockGenerate(request: GenerateRequest): GenerateResult {
  const text = request.userText ?? "";
  for (const [marker, code] of Object.entries(FAILURES)) {
    if (text.includes(marker)) return { ok: false, code };
  }
  if (text.includes("[mock:malformed]")) return ok({ unexpected: true });
  const foreign = text.includes("[mock:foreign]");
  const data = request.data as Data;
  switch (request.capability) {
    case "review":
      return ok(review(data));
    case "priorities":
      return ok(priorities(data));
    case "goal_plan":
      return ok(goalPlan(data, foreign));
    case "contributions":
      return ok(contributions(data));
    case "automation_rule":
      return ok(automation(data, foreign));
    case "question":
      return ok(question(data));
  }
}

function review(data: Data) {
  const facts = data.facts as {
    tasks: {
      open: number;
      overdue: number;
      blocked: number;
      overdueItems: { id: string; title: string }[];
    };
    goals: { withoutOpenTasks: { id: string; title: string }[] };
    finance: { hasAccounts: boolean; accountsWithoutValuation: number; staleValuations: number };
    automation: {
      disabled: number;
      schedulerConfigured: boolean;
      recentFailures: { ruleId: string }[];
    };
  };
  const recommendations = [];
  const first = facts.tasks.overdueItems[0];
  if (first) {
    recommendations.push({
      area: "tasks",
      action: `先处理逾期任务「${first.title}」`,
      reason: `共有 ${facts.tasks.overdue} 个逾期任务，这是最早到期的一个。`,
      uncertainty: "low",
      entity: { type: "task", id: first.id },
    });
  }
  const goal = facts.goals.withoutOpenTasks[0];
  if (goal) {
    recommendations.push({
      area: "goals",
      action: `为目标「${goal.title}」安排下一步行动`,
      reason: "这个进行中的目标没有未完成的关联任务。",
      uncertainty: "medium",
      entity: { type: "goal", id: goal.id },
    });
  }
  if (facts.finance.accountsWithoutValuation + facts.finance.staleValuations > 0) {
    recommendations.push({
      area: "finance",
      action: "补录缺失或过期的账户估值",
      reason: "部分账户没有估值或估值已过期，资产总览并不完整。",
      uncertainty: "low",
      entity: null,
    });
  }
  return {
    summary: `你有 ${facts.tasks.open} 个未完成任务，其中 ${facts.tasks.overdue} 个已逾期，${facts.tasks.blocked} 个在等待前置任务。`,
    interpretations: [
      {
        area: "tasks",
        text:
          facts.tasks.overdue > 0
            ? "逾期任务较多，可能说明近期计划偏紧。"
            : "目前没有逾期任务，计划执行情况良好。",
      },
      {
        area: "automation",
        text: facts.automation.schedulerConfigured
          ? "定时任务调度已配置。"
          : "定时任务调度器未配置，定时规则不会自动运行。",
      },
    ],
    recommendations,
  };
}

function priorities(data: Data) {
  const tasks = (data.openTasks as CtxTask[]) ?? [];
  const recommendations = tasks.slice(0, 5).map((task) => {
    const blocked = task.openBlockers > 0;
    const overdue = task.dueDate !== null && task.dueDate < (data.today as string);
    return {
      taskId: task.id,
      action: blocked ? "unblock_first" : overdue ? "do_now" : "schedule",
      reason: blocked
        ? `「${task.title}」还有 ${task.openBlockers} 个前置任务未完成。`
        : overdue
          ? `「${task.title}」已于 ${task.dueDate} 到期。`
          : `「${task.title}」${task.dueDate ? `将于 ${task.dueDate} 到期` : "没有截止日期"}。`,
      benefit: task.growsFocusAttribute ? "推进当前重点成长能力。" : "减少积压，降低逾期风险。",
      uncertainty: blocked ? "medium" : "low",
      nextStep: blocked ? "先查看并完成前置任务。" : null,
      suggestedPriority: overdue && task.priority < 4 ? Math.min(4, task.priority + 1) : null,
    };
  });
  return {
    recommendations,
    notes: tasks.length === 0 ? ["当前没有未完成的任务。"] : [],
  };
}

function goalPlan(data: Data, foreign: boolean) {
  const goal = data.goal as {
    title: string;
    attributes: { attributeId: string; weight: number }[];
  };
  const growth = (data.growthAttributes as Attr[]) ?? [];
  const attributeId = foreign
    ? FOREIGN_ID
    : (goal.attributes[0]?.attributeId ?? growth[0]?.id ?? null);
  const contributions = attributeId ? [{ attributeId, weight: 2 }] : [];
  return {
    summary: `把「${goal.title}」拆成三个阶段：准备、练习、复盘。`,
    steps: [
      { title: "准备", rationale: "明确范围和所需资源。" },
      { title: "练习", rationale: "用固定节奏持续投入。" },
      { title: "复盘", rationale: "检查进展并调整计划。" },
    ],
    tasks: [
      {
        title: `${goal.title}：列出学习资源`,
        stepIndex: 0,
        dueInDays: 2,
        estimatedMinutes: 30,
        contributions,
      },
      {
        title: `${goal.title}：完成第一次练习`,
        stepIndex: 1,
        dueInDays: 7,
        estimatedMinutes: 60,
        contributions,
      },
      {
        title: `${goal.title}：第一周复盘`,
        stepIndex: 2,
        dueInDays: 14,
        estimatedMinutes: 20,
        contributions: [],
      },
    ],
    assumptions: ["每周大约可以投入 3 小时。"],
  };
}

function contributions(data: Data) {
  const task = data.task as { title: string };
  const growth = (data.growthAttributes as Attr[]) ?? [];
  const matched = growth.filter((a) => a.name && task.title.includes(a.name));
  const picks = (matched.length > 0 ? matched : growth.slice(0, 1)).slice(0, 2);
  return {
    explanation:
      matched.length > 0
        ? "任务标题直接提到了这些能力。"
        : "没有明确匹配，给出最接近的一项供参考。",
    contributions: picks.map((a, index) => ({
      attributeId: a.id,
      weight: index === 0 ? 3 : 1,
      reason: `任务「${task.title}」与「${a.name}」相关。`,
    })),
  };
}

function automation(data: Data, foreign: boolean) {
  const request = String(data.request ?? "");
  const unsupported = /(邮件|短信|email|webhook|删除|经验|XP|自制力|余额)/i;
  if (unsupported.test(request)) {
    return {
      supported: false,
      explanation: "这个请求包含自动化引擎不支持的操作。",
      unsupportedReasons: ["只能创建任务、发送应用内通知或调整触发任务的优先级。"],
      rule: null,
    };
  }
  const daily = request.match(/每天\s*(\d{1,2})[:：点]?(\d{2})?/);
  if (daily) {
    const hh = daily[1]!.padStart(2, "0");
    const mm = daily[2] ?? "00";
    return {
      supported: true,
      explanation: `每天 ${hh}:${mm} 发送一条应用内通知。`,
      unsupportedReasons: [],
      rule: {
        name: "每日提醒",
        description: null,
        trigger: { type: "schedule", schedule: { kind: "daily", time: `${hh}:${mm}` } },
        conditions: [],
        actions: [{ type: "notify", title: "每日提醒：{date}", body: null }],
      },
    };
  }
  const projects = (data.projects as Attr[]) ?? [];
  const project = foreign ? { id: FOREIGN_ID } : projects[0];
  return {
    supported: true,
    explanation: "任务完成后创建一个跟进任务，两天后到期。",
    unsupportedReasons: [],
    rule: {
      name: "完成后跟进",
      description: null,
      trigger: { type: "task.completed" },
      conditions: project ? [{ type: "task_project", projectId: project.id }] : [],
      actions: [
        {
          type: "create_follow_up_task",
          title: "跟进：{task}",
          description: null,
          priority: 2,
          dueInDays: 2,
        },
      ],
    },
  };
}

function question(data: Data) {
  const facts = data.facts as { tasks: { open: number; overdue: number } };
  return {
    answer: `根据当前数据，你有 ${facts.tasks.open} 个未完成任务，其中 ${facts.tasks.overdue} 个已逾期。`,
    basedOn: ["tasks"],
    dataGaps: [],
  };
}
