/*
 * The automation worker state the tests expect, declared by whoever runs the suite:
 *
 *   (default) "off"  — the server Playwright starts has no AUTOMATION_WORKER_SECRET, so no
 *                      worker ticks: the UI must say so.
 *   E2E_AUTOMATION_WORKER=running — the suite runs against a deployment with the worker
 *                      (deploy/compose.yaml): the UI must report it running.
 *
 * Tests assert the text for the declared state; a mismatch between declaration and reality fails.
 */
export type WorkerMode = "off" | "running";

export const workerMode: WorkerMode =
  process.env.E2E_AUTOMATION_WORKER === "running" ? "running" : "off";

/** What the automation health card says about the scheduler. */
export const schedulerText: Record<WorkerMode, string> = {
  off: "未配置后台 worker",
  running: "计划调度运行中",
};

/** What the 自制力 panel says about the overdue check. */
export const disciplineWorkerText: Record<WorkerMode, string> = {
  off: "后台 worker 未运行",
  running: "后台 worker 正在运行",
};
