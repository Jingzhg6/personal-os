"use client";

import { CircleAlert, FlaskConical, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/shared/ui/card";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { useAiStatus } from "./use-ai";

/**
 * What the provider is: unavailable (no configuration), simulated (the test provider, whose
 * output is not AI) or a real model. Never shows keys, URLs or prompts — the API has none.
 */
export function AiStatusNotice() {
  const t = useTranslations("ai.status");
  const { data } = useAiStatus();
  if (!data) return null;
  if (!data.available) {
    return (
      <Card data-testid="ai-unavailable" className="border-warning/60">
        <CardContent className="flex gap-3 text-sm">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("unavailableTitle")}</p>
            <p className="text-muted-foreground">
              {data.unavailableReason === "missing_key"
                ? t("missingKeyBody")
                : t("unavailableBody")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
      data-testid="ai-status"
      data-provider={data.provider}
    >
      {data.simulated ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium"
          data-testid="ai-simulated"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          {t("simulated")}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <Sparkles className="size-3.5" aria-hidden />
          {t("model", { model: data.model ?? "" })}
        </span>
      )}
      <span className="text-muted-foreground">
        {data.simulated ? t("simulatedHint") : t("principle")}
      </span>
      <span className="text-xs text-muted-foreground sm:ml-auto">
        {t("usage", {
          used: data.limits.usedToday,
          daily: data.limits.daily,
          perMinute: data.limits.perMinute,
        })}
      </span>
    </div>
  );
}

/** A failed generation: the reason, never a substitute answer. */
export function GenerateError({ error }: { error: unknown }) {
  const t = useTranslations("ai.status");
  const message = useErrorMessage();
  const code = (error as { data?: { domainCode?: string | null } } | null)?.data?.domainCode;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm"
      data-testid="ai-error"
      data-code={code ?? "unknown"}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{t("failedTitle")}</p>
        <p className="text-muted-foreground">{message(error)}</p>
      </div>
    </div>
  );
}
