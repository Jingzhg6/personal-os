/*
 * Database integrity check (Phase 1 integration). Read-only: runs invariants that foreign keys
 * and CHECK constraints cannot express — mostly that every cross-table reference stays within one
 * user, plus a few domain invariants — and prints the number of violating rows per check.
 *
 *   pnpm db:integrity                     uses DATABASE_URL (.env.local / .env)
 *   DATABASE_URL=postgres://… pnpm db:integrity
 *
 * Exit code 1 if any check finds a violation, if migrations are pending, or if the database has
 * applied migrations that this code does not contain.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"], quiet: true });

/** A check returns the violating rows' count. */
const sameUser = (child: string, fk: string, parent: string, parentKey = "id") =>
  `select count(*) from ${child} c join ${parent} p on p.${parentKey} = c.${fk} where p.user_id <> c.user_id`;

const checks: [string, string][] = [
  // Ownership: references through single-column foreign keys stay within one user.
  ["tasks → areas", sameUser("tasks", "area_id", "areas")],
  ["tasks → projects", sameUser("tasks", "project_id", "projects")],
  ["tasks → milestones", sameUser("tasks", "milestone_id", "milestones")],
  ["tasks → parent task", sameUser("tasks", "parent_task_id", "tasks")],
  ["tasks → statuses", sameUser("tasks", "status_id", "task_statuses")],
  ["projects → areas", sameUser("projects", "area_id", "areas")],
  ["milestones → projects", sameUser("milestones", "project_id", "projects")],
  [
    "task_tags: task and tag of one user",
    `select count(*) from task_tags tt join tasks t on t.id = tt.task_id join tags g on g.id = tt.tag_id where t.user_id <> g.user_id`,
  ],
  [
    "task_dependencies: both tasks of the row's user",
    `select count(*) from task_dependencies d join tasks a on a.id = d.blocking_task_id join tasks b on b.id = d.blocked_task_id where a.user_id <> d.user_id or b.user_id <> d.user_id`,
  ],
  [
    "task contributions: task and attribute of one user",
    `select count(*) from task_development_contributions c join tasks t on t.id = c.task_id join development_attributes a on a.id = c.attribute_id where t.user_id <> a.user_id`,
  ],
  [
    "goal ↔ task links of one user",
    `select count(*) from development_goal_tasks l join development_goals g on g.id = l.goal_id join tasks t on t.id = l.task_id where g.user_id <> t.user_id`,
  ],
  [
    "goal ↔ project links of one user",
    `select count(*) from development_goal_projects l join development_goals g on g.id = l.goal_id join projects p on p.id = l.project_id where g.user_id <> p.user_id`,
  ],
  [
    "goal attributes of the goal's user",
    `select count(*) from development_goal_attributes l join development_goals g on g.id = l.goal_id join development_attributes a on a.id = l.attribute_id where g.user_id <> a.user_id`,
  ],
  ["focus attributes", sameUser("development_focus", "attribute_id", "development_attributes")],
  ["plans → goals", sameUser("development_plans", "goal_id", "development_goals")],
  ["xp_ledger → attribute", sameUser("xp_ledger", "attribute_id", "development_attributes")],
  ["xp_ledger reversal → entry", sameUser("xp_ledger", "reversal_of", "xp_ledger")],
  ["xp credits → ledger entry", sameUser("xp_attribute_credits", "ledger_entry_id", "xp_ledger")],
  [
    "xp credits → attribute",
    sameUser("xp_attribute_credits", "attribute_id", "development_attributes"),
  ],
  [
    "discipline → attribute",
    sameUser("discipline_ledger", "attribute_id", "development_attributes"),
  ],
  ["discipline → task", sameUser("discipline_ledger", "task_id", "tasks")],
  ["reward_ledger → reward", sameUser("reward_ledger", "reward_id", "rewards")],
  ["reward_ledger → level reward", sameUser("reward_ledger", "level_reward_id", "level_rewards")],
  ["reward_ledger refund → entry", sameUser("reward_ledger", "refund_of", "reward_ledger")],

  ["tasks → recurring series", sameUser("tasks", "recurrence_id", "task_recurrences")],

  // Domain invariants.
  [
    "a recurring series has at most one open instance",
    `select count(*) from (select t.recurrence_id from tasks t join task_statuses s on s.id = t.status_id
       where t.recurrence_id is not null and t.deleted_at is null
         and s.category in ('backlog', 'unstarted', 'started')
       group by t.recurrence_id having count(*) > 1) x`,
  ],
  [
    "task milestone belongs to the task's project",
    `select count(*) from tasks t join milestones m on m.id = t.milestone_id where t.project_id is distinct from m.project_id`,
  ],
  [
    "subtasks carry no project or milestone of their own",
    `select count(*) from tasks where parent_task_id is not null and (project_id is not null or milestone_id is not null)`,
  ],
  [
    "status category matches its timestamps",
    `select count(*) from tasks t join task_statuses s on s.id = t.status_id
      where (s.category = 'completed') <> (t.completed_at is not null)
         or (s.category = 'cancelled') <> (t.cancelled_at is not null)
         or (s.category = 'failed') <> (t.failed_at is not null)`,
  ],
  [
    "due time only with a due date",
    `select count(*) from tasks where due_time is not null and due_date is null`,
  ],
  ["start date not after due date", `select count(*) from tasks where start_date > due_date`],
  [
    "planning time only with a due date",
    `select count(*) from tasks where due_date is null and planned_at is not null`,
  ],
  [
    "no self-dependency",
    `select count(*) from task_dependencies where blocking_task_id = blocked_task_id`,
  ],
  [
    "xp reversal undoes its entry exactly once",
    `select count(*) from (select r.reversal_of from xp_ledger r join xp_ledger o on o.id = r.reversal_of
       group by r.reversal_of, o.amount having count(*) > 1 or sum(r.amount) <> -o.amount) x`,
  ],
  [
    "自制力: each task's net equals its latest net_after",
    `select count(*) from (select task_id, sum(points) as net,
        (array_agg(net_after order by seq desc))[1] as last from discipline_ledger group by task_id) x
      where net <> last`,
  ],
  [
    "自制力: entry numbers per task are 1..n",
    `select count(*) from (select task_id, count(*) n, max(seq) m, min(seq) lo from discipline_ledger group by task_id) x where n <> m or lo <> 1`,
  ],
  [
    "exactly one 自制力 attribute per user",
    `select count(*) from users u where (select count(*) from development_attributes a where a.user_id = u.id and a.system_key = 'discipline') <> 1`,
  ],
  [
    "every user has default statuses",
    `select count(*) from users u where not exists (select 1 from task_statuses s where s.user_id = u.id)`,
  ],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  let failed = 0;
  try {
    // Migration history must equal this code's migrations, compared by hash as drizzle records
    // them: none pending, and none applied that this code does not have (e.g. from another
    // branch — the migrator would then skip a later-numbered but older-dated file silently).
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { tag: string }[];
    };
    const files = new Map(
      journal.entries.map((e) => [
        createHash("sha256")
          .update(readFileSync(`drizzle/${e.tag}.sql`, "utf8"))
          .digest("hex"),
        e.tag,
      ]),
    );
    const applied = await client.query<{ hash: string; created_at: string }>(
      "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at",
    );
    const appliedHashes = new Set(applied.rows.map((r) => r.hash));
    const pending = [...files].filter(([hash]) => !appliedHashes.has(hash)).map(([, tag]) => tag);
    const unknown = applied.rows.filter((r) => !files.has(r.hash));
    console.log(
      `${pending.length === 0 ? "ok  " : "FAIL"}  migrations applied: ${files.size - pending.length} of ${files.size}` +
        (pending.length ? ` — pending: ${pending.join(", ")}` : ""),
    );
    if (pending.length) failed += 1;
    console.log(
      `${unknown.length === 0 ? "ok  " : "FAIL"}  applied migrations not in this code: ${unknown.length}` +
        (unknown.length
          ? ` — ${unknown.map((r) => `${r.hash.slice(0, 10)}… (created_at ${r.created_at})`).join(", ")}`
          : ""),
    );
    if (unknown.length) failed += 1;
    const invalid = await client.query("select conname from pg_constraint where not convalidated");
    console.log(
      `${invalid.rowCount === 0 ? "ok  " : "FAIL"}  unvalidated constraints: ${invalid.rowCount}`,
    );
    if (invalid.rowCount) failed += 1;

    await client.query("begin read only");
    for (const [name, sql] of checks) {
      const result = await client.query<{ count: string }>(sql);
      const n = Number(result.rows[0]!.count);
      console.log(`${n === 0 ? "ok  " : "FAIL"}  ${name}${n === 0 ? "" : `: ${n} row(s)`}`);
      if (n > 0) failed += 1;
    }
    await client.query("rollback");
    const users = await client.query<{ n: string }>("select count(*)::text as n from users");
    console.log(
      `\n${checks.length + 3} checks, ${failed} failed, over ${users.rows[0]!.n} user(s).`,
    );
  } finally {
    await client.end();
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("integrity check could not run:", (error as Error).message);
  process.exit(2);
});
