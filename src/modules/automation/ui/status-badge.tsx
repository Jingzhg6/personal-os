"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";

import type { ExecutionStatus } from "../domain";

const tone: Record<ExecutionStatus, string> = {
  running: "bg-primary/12 text-primary",
  succeeded: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  partial: "bg-warning/20 text-foreground",
  skipped: "bg-surface-muted text-muted-foreground",
};

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  const t = useTranslations("automation.status");
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone[status],
      )}
      data-testid="execution-status"
    >
      {t(status)}
    </span>
  );
}
