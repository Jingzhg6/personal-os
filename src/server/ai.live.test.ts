import { mkdirSync, writeFileSync } from "node:fs";

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aiRequests } from "@/modules/ai/db";
import type { AiProposal, GenerateInput } from "@/modules/ai/domain";
import { generate, providerFromEnv, type AdvisorDeps } from "@/modules/ai/server";
import { automationRules } from "@/modules/automation/db";
import { disciplineLedger, xpLedger } from "@/modules/character/db";
import { tasks } from "@/modules/tasks/db";
import { getEnv } from "@/shared/config/env";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * M11.1 live verification against the real Anthropic API. NEVER runs by default (no paid calls in
 * CI or `pnpm test`):
 *
 *   AI_LIVE_VERIFY=auth  pnpm ai:verify   one request with a deliberately invalid key (free: 401)
 *   AI_LIVE_VERIFY=1     pnpm ai:verify   + the real smoke test; needs AI_PROVIDER=anthropic and
 *                                           AI_API_KEY in .env.local
 *
 * Call budget with AI_LIVE_VERIFY=1: 7 provider calls (1 invalid key, 5 smoke generations, 1
 * unknown model). The adapter retries a call once after a 429, 5xx or lost connection, so the
 * HTTP ceiling is 13 requests; at most 5 can return a billable generation (a retry only follows a
 * failed attempt). Every check records its actual HTTP request count.
 *
 * Results (codes, tokens, estimated cost, HTTP counts — no content, no key) go to
 * test-results/ai-live.json. Only AI_API_KEY / AI_BASE_URL / AI_MODEL are read; the adapter
 * never uses ambient ANTHROPIC_* credentials (see anthropic-adapter.test.ts).
 */

const mode = process.env.AI_LIVE_VERIFY;
const live = mode === "1";
const PRICE = { "claude-opus-5-5": { input: 4, output: 20 } } as Record<
  string,
  { input: number; output: number }
>;

const results: Record<string, unknown>[] = [];
const record = (entry: Record<string, unknown>) => results.push(entry);

const { db, close } = createTestDb();
const caller = createCallerFactory(appRouter);
const bus = createAppEventBus();

afterAll(async () => {
  if (mode) {
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/ai-live.json", JSON.stringify(results, null, 2));
  }
  await close();
});

describe.skipIf(!mode)("live: invalid credentials", () => {
  it("maps the API's real 401 to ai.auth_failed, without a retry or a crash", async () => {
    const env = getEnv();
    let calls = 0;
    const counted = providerFromEnv(
      {
        ...env,
        AI_PROVIDER: "anthropic",
        AI_API_KEY: "sk-ant-api03-invalid-key-for-m11-1-verification",
        AI_BASE_URL: "https://api.anthropic.com",
      },
      {
        fetch: (input, init) => {
          calls += 1;
          return fetch(input, init);
        },
      },
    )!;
    const { outputSchemas } = await import("@/modules/ai/domain");
    const request = {
      capability: "question" as const,
      system: "s",
      prompt: "p",
      data: {},
      userText: null,
      schema: outputSchemas.question,
    };
    const result = await counted.generate(request);
    record({ check: "invalid_key", result, httpCalls: calls });
    expect(result).toEqual({ ok: false, code: "ai.auth_failed" });
    expect(calls).toBe(1);
  });
});

describe.skipIf(!live)("live: smoke test of the four proposal types", () => {
  let deps: AdvisorDeps;
  let userId: string;
  let ids: Record<string, string>;
  let discipline: string;
  let api: ReturnType<typeof caller>;
  let httpCalls = 0;
  const countingFetch: typeof fetch = (input, init) => {
    httpCalls += 1;
    return fetch(input, init);
  };

  beforeAll(async () => {
    const env = getEnv();
    const provider = providerFromEnv(env, { fetch: countingFetch });
    if (env.AI_PROVIDER !== "anthropic" || !provider) {
      throw new Error("AI_LIVE_VERIFY=1 needs AI_PROVIDER=anthropic and AI_API_KEY");
    }
    await resetDb(db);
    const user = await createSeededUser(db);
    userId = user.id;
    api = caller({ db, bus, userId, resHeaders: null });
    deps = {
      db,
      provider,
      dailyLimit: 10,
      perMinuteLimit: 10,
      timeoutMs: env.AI_TIMEOUT_MS,
      schedulerConfigured: false,
    };
    const attributes = await api.character.attributes.list();
    const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
    discipline = attr("discipline");
    await api.settings.update({ timeZone: "Asia/Shanghai" });
    const report = await api.tasks.create({
      title: "提交季度报告",
      dueDate: "2026-01-05",
      priority: 2,
    });
    const release = await api.tasks.create({ title: "发布个人网站新首页", dueDate: "2026-12-01" });
    const testing = await api.tasks.create({
      title: "完成首页的浏览器测试",
      dueDate: "2026-11-25",
    });
    await api.tasks.dependencies.add({ blockingTaskId: testing.id, blockedTaskId: release.id });
    const french = await api.tasks.create({ title: "法语听力练习 30 分钟" });
    const goal = await api.development.goals.create({
      title: "通过法语 B2 考试",
      targetDate: "2027-06-30",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    await api.projects.create({ name: "个人网站改版" });
    ids = {
      report: report.id,
      release: release.id,
      testing: testing.id,
      french: french.id,
      goal: goal.id,
    };
  });

  const snapshot = async () => ({
    tasks: (await db.select({ n: count() }).from(tasks))[0]!.n,
    rules: (await db.select({ n: count() }).from(automationRules))[0]!.n,
    xp: (await db.select({ n: count() }).from(xpLedger))[0]!.n,
    discipline: (await db.select({ n: count() }).from(disciplineLedger))[0]!.n,
  });

  async function run(name: string, input: GenerateInput) {
    const before = await snapshot();
    const started = Date.now();
    httpCalls = 0;
    let proposal: AiProposal | null = null;
    let code: string | null = null;
    try {
      proposal = await generate(deps, userId, input);
    } catch (error) {
      code = (error as { code?: string }).code ?? "unexpected";
    }
    const [usage] = await db
      .select()
      .from(aiRequests)
      .where(eq(aiRequests.userId, userId))
      .orderBy(aiRequests.createdAt)
      .then((rows) => rows.slice(-1));
    const price = PRICE[deps.provider!.model];
    const cost =
      price && usage?.inputTokens != null && usage.outputTokens != null
        ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1e6
        : null;
    record({
      check: name,
      model: deps.provider!.model,
      ok: proposal !== null,
      errorCode: code,
      status: proposal?.status ?? null,
      items: proposal?.items.length ?? 0,
      inputChars: usage?.inputChars ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      durationMs: usage?.durationMs ?? Date.now() - started,
      costUsd: cost,
      costIsEstimate: true,
      httpCalls,
    });
    // Nothing is executed by generating, whatever the outcome.
    expect(await snapshot()).toEqual(before);
    return { proposal, code };
  }

  it("1. priority recommendations: valid, only the user's open tasks, blocked never 'do now'", async () => {
    const { proposal, code } = await run("priorities", { capability: "priorities" });
    expect(code).toBeNull();
    const a = proposal!.analysis;
    if (a.kind !== "priorities") throw new Error("kind");
    // Four open tasks, one overdue: an empty answer is not a successful verification.
    expect(a.recommendations.length).toBeGreaterThan(0);
    for (const r of a.recommendations) {
      expect([ids.report, ids.release, ids.testing, ids.french]).toContain(r.taskId);
      if (r.taskId === ids.release) expect(r.action).not.toBe("do_now");
    }
    expect((await api.tasks.byId({ id: ids.report })).priority).toBe(2);
  });

  it("2. goal plan: valid, contributions only from the user's growth attributes", async () => {
    const { proposal, code } = await run("goal_plan", {
      capability: "goal_plan",
      goalId: ids.goal,
      note: "每周大约 3 小时",
    });
    expect(code).toBeNull();
    expect(proposal!.items.length).toBeGreaterThan(0);
    for (const item of proposal!.items) {
      expect(item.change.type).toBe("create_goal_task");
      if (item.change.type === "create_goal_task") {
        expect(item.change.contributions.map((c) => c.attributeId)).not.toContain(discipline);
      }
    }
  });

  it("3. growth contributions: valid, never 自制力", async () => {
    const { proposal, code } = await run("contributions", {
      capability: "contributions",
      taskId: ids.french,
    });
    expect(code).toBeNull();
    expect(JSON.stringify(proposal!.items)).not.toContain(discipline);
    expect((await api.tasks.byId({ id: ids.french })).contributions).toEqual([]);
  });

  it("4a. automation draft: a supported request becomes a valid rule draft, not a rule", async () => {
    const { proposal, code } = await run("automation_supported", {
      capability: "automation_rule",
      request: "每天早上 8:30 提醒我查看今天的计划",
    });
    expect(code).toBeNull();
    expect(proposal!.status).toBe("proposed");
    expect(proposal!.items[0]!.change.type).toBe("create_automation_rule");
  });

  it("4b. automation draft: an unsupported request is explained, not approximated", async () => {
    const { proposal, code } = await run("automation_unsupported", {
      capability: "automation_rule",
      request: "每次完成任务后给我的邮箱发一封邮件",
    });
    expect(code).toBeNull();
    expect(proposal!.items).toHaveLength(0);
    expect(proposal!.analysis).toMatchObject({ kind: "automation_rule", supported: false });
  });

  it("5. an unknown model fails clearly as ai.model_unavailable (not billed)", async () => {
    const env = getEnv();
    httpCalls = 0;
    const provider = providerFromEnv(
      { ...env, AI_MODEL: "claude-model-that-does-not-exist" },
      { fetch: countingFetch },
    )!;
    const { outputSchemas } = await import("@/modules/ai/domain");
    const result = await provider.generate({
      capability: "question",
      system: "s",
      prompt: "p",
      data: {},
      userText: null,
      schema: outputSchemas.question,
    });
    record({ check: "unknown_model", result, httpCalls });
    expect(result).toEqual({ ok: false, code: "ai.model_unavailable" });
    expect(httpCalls).toBe(1);
  });
});
